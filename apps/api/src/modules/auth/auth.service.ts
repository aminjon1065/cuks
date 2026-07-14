import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS_REQUIRING_2FA,
  buildAbility,
  serializeAbility,
  type ChangePasswordInput,
  type LoginInput,
  type MeResponse,
  type SessionInfo,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/auth/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService, type UserRow } from '../users/users.service';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { type CreatedSession, SessionService } from './session.service';
import { TotpService } from './totp.service';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  session: CreatedSession;
  mustChangePassword: boolean;
}

const isSixDigits = (value: string): boolean => /^\d{6}$/.test(value);

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly lockout: LockoutService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async login(input: LoginInput, ctx: RequestContext): Promise<LoginResult> {
    const ip = ctx.ip ?? 'unknown';
    // Per-IP request rate limiting is enforced by ThrottleGuard on the route.

    if (await this.lockout.isLocked(input.username, ip)) {
      this.audit.log({ action: 'auth.lockout', ip, meta: { username: input.username } });
      throw AppException.tooManyRequests('auth.login.locked', 'Too many attempts, try later');
    }

    const user = await this.users.findActiveByUsername(input.username);

    // Always spend argon2 time (dummy hash for a missing user) so the response
    // time does not reveal whether the username exists (anti-enumeration).
    let passwordOk = false;
    if (user) {
      passwordOk = await this.passwords.verify(user.passwordHash, input.password);
    } else {
      await this.passwords.verifyDummy(input.password);
    }

    const failLogin = async (actorId: string | null): Promise<AppException> => {
      await this.lockout.recordFailure(input.username, ip);
      this.audit.log({
        action: 'auth.login.failure',
        actorId,
        ip,
        meta: { username: input.username },
      });
      return AppException.unauthorized('auth.login.invalid_credentials', 'Invalid credentials');
    };

    if (!user || !passwordOk) throw await failLogin(user?.id ?? null);

    // Reveal blocked status only after a correct password (anti-enumeration).
    if (user.status === 'blocked') {
      this.audit.log({
        action: 'auth.login.failure',
        actorId: user.id,
        ip,
        meta: { blocked: true },
      });
      throw AppException.forbidden('auth.login.blocked', 'Account is blocked');
    }

    if (user.totpEnabled) {
      if (!input.totp) {
        throw AppException.unauthorized('auth.login.totp_required', 'Two-factor code required');
      }
      if (!(await this.verifyTotp(user, input.totp))) {
        await this.lockout.recordFailure(input.username, ip);
        this.audit.log({
          action: 'auth.login.failure',
          actorId: user.id,
          ip,
          meta: { totp: true },
        });
        throw AppException.unauthorized('auth.login.totp_invalid', 'Invalid two-factor code');
      }
    }

    await this.lockout.reset(input.username, ip);
    const session = await this.sessions.create(user.id, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      remember: input.remember,
    });
    await this.users.markLoggedIn(user.id);
    this.audit.log({ action: 'auth.login.success', actorId: user.id, ip });

    return { session, mustChangePassword: user.mustChangePassword };
  }

  async logout(user: AuthUser): Promise<void> {
    await this.sessions.revoke(user.id, user.sessionId);
    this.audit.log({ action: 'auth.logout', actorId: user.id });
  }

  listSessions(user: AuthUser): Promise<SessionInfo[]> {
    return this.sessions.list(user.id, user.sessionId);
  }

  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    if (sessionId === user.sessionId) {
      throw AppException.badRequest(
        'auth.session.cannot_revoke_current',
        'Use logout for the current session',
      );
    }
    const removed = await this.sessions.revoke(user.id, sessionId);
    if (!removed) {
      throw AppException.notFound('auth.session.not_found', 'Session not found');
    }
    this.audit.log({ action: 'auth.session.revoked', actorId: user.id, meta: { sessionId } });
  }

  async logoutAll(user: AuthUser): Promise<void> {
    await this.sessions.revokeAll(user.id);
    this.audit.log({ action: 'auth.session.revoked', actorId: user.id, meta: { all: true } });
  }

  async changePassword(user: AuthUser, input: ChangePasswordInput): Promise<void> {
    const row = await this.users.findActiveById(user.id);
    if (!row || !(await this.passwords.verify(row.passwordHash, input.currentPassword))) {
      throw AppException.unprocessable(
        'auth.password.invalid_current',
        'Current password is wrong',
      );
    }
    const hash = await this.passwords.hash(input.newPassword);
    await this.users.setPassword(user.id, hash);
    // Force re-login on other devices after a password change.
    await this.sessions.revokeAll(user.id, user.sessionId);
    this.audit.log({ action: 'auth.password.changed', actorId: user.id });
    // Security notification; display text is localized on the client from `type`.
    await this.notifications.notify({
      userId: user.id,
      type: 'system.account.password_changed',
      title: 'Password changed',
      body: 'Your account password was changed.',
      priority: 'normal',
      emailMode: 'always',
    });
  }

  async setupTotp(user: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    if (user.totpEnabled) {
      throw AppException.unprocessable(
        'auth.totp.already_enabled',
        'Two-factor is already enabled',
      );
    }
    // Idempotent for pending enrollment: reuse an existing un-confirmed secret
    // instead of minting a new one, so repeated setup calls (client retries,
    // React StrictMode, a second tab) can't leave the shown secret out of sync
    // with the one `confirmTotp` will verify against. A fresh secret is generated
    // only when none is pending.
    const row = await this.users.findActiveById(user.id);
    if (row?.totpSecret) {
      const secret = this.crypto.decrypt(row.totpSecret);
      return { secret, otpauthUrl: this.totp.keyUri(user.username, secret) };
    }
    const secret = this.totp.generateSecret();
    await this.users.setTotp(user.id, this.crypto.encrypt(secret), false);
    this.audit.log({ action: 'auth.totp.setup', actorId: user.id });
    return { secret, otpauthUrl: this.totp.keyUri(user.username, secret) };
  }

  async confirmTotp(user: AuthUser, code: string): Promise<{ backupCodes: string[] }> {
    if (user.totpEnabled) {
      throw AppException.unprocessable(
        'auth.totp.already_enabled',
        'Two-factor is already enabled',
      );
    }
    const row = await this.users.findActiveById(user.id);
    if (!row?.totpSecret) {
      throw AppException.unprocessable('auth.totp.not_setup', 'Start two-factor setup first');
    }
    if (!this.totp.verify(code, this.crypto.decrypt(row.totpSecret))) {
      throw AppException.unprocessable('auth.totp.invalid_code', 'Invalid two-factor code');
    }
    await this.users.setTotp(user.id, row.totpSecret, true);
    const backupCodes = await this.totp.regenerateBackupCodes(user.id);
    this.audit.log({ action: 'auth.totp.enabled', actorId: user.id });
    return { backupCodes };
  }

  async disableTotp(user: AuthUser, code: string): Promise<void> {
    if (!user.totpEnabled) {
      throw AppException.unprocessable('auth.totp.not_enabled', 'Two-factor is not enabled');
    }
    if (this.isTotpRequired(user)) {
      throw AppException.unprocessable(
        'auth.totp.required_for_role',
        'Two-factor is required for your role',
      );
    }
    const row = await this.users.findActiveById(user.id);
    const valid =
      !!row?.totpSecret &&
      (this.totp.verify(code, this.crypto.decrypt(row.totpSecret)) ||
        (await this.totp.consumeBackupCode(user.id, code)));
    if (!valid) {
      throw AppException.unprocessable('auth.totp.invalid_code', 'Invalid two-factor code');
    }
    await this.users.clearTotp(user.id);
    await this.totp.clearBackupCodes(user.id);
    this.audit.log({ action: 'auth.totp.disabled', actorId: user.id });
  }

  async buildMe(user: AuthUser): Promise<MeResponse> {
    const ability = buildAbility({
      permissions: user.permissions,
      isSuperadmin: user.isSuperadmin,
    });
    const orgContext = await this.users.getOrgContext(user.id);
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      shortName: user.shortName,
      email: user.email,
      locale: user.locale,
      theme: user.theme,
      totpEnabled: user.totpEnabled,
      totpRequired: this.isTotpRequired(user),
      mustChangePassword: user.mustChangePassword,
      permissions: user.permissions,
      isSuperadmin: user.isSuperadmin,
      abilityRules: serializeAbility(ability),
      orgContext,
    };
  }

  isTotpRequired(user: Pick<AuthUser, 'permissions' | 'isSuperadmin'>): boolean {
    return user.isSuperadmin || user.permissions.some((p) => PERMISSIONS_REQUIRING_2FA.includes(p));
  }

  private async verifyTotp(user: UserRow, code: string): Promise<boolean> {
    if (isSixDigits(code) && user.totpSecret) {
      return this.totp.verifyForLogin(user.id, code, this.crypto.decrypt(user.totpSecret));
    }
    return this.totp.consumeBackupCode(user.id, code);
  }
}
