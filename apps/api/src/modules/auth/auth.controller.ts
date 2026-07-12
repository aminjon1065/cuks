import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AUTH_LOGIN_RATE_PER_MINUTE,
  changePasswordSchema,
  loginSchema,
  totpCodeSchema,
  type ChangePasswordInput,
  type LoginInput,
  type MeResponse,
  type SessionInfo,
  type TotpCodeInput,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { clearSessionCookies, setSessionCookies } from '../../common/auth/session-cookies';
import { ConfigService } from '../../config/config.service';
import { AllowDuringPasswordChange } from '../../common/decorators/allow-password-change.decorator';
import { AllowDuringTotpEnrollment } from '../../common/decorators/allow-totp-enrollment.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipSessionRefresh } from '../../common/decorators/skip-session-refresh.decorator';
import { Throttle } from '../../common/decorators/throttle.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle(AUTH_LOGIN_RATE_PER_MINUTE)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ mustChangePassword: boolean }> {
    const result = await this.auth.login(body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    setSessionCookies(reply, {
      sessionId: result.session.sessionId,
      csrfToken: result.session.csrfToken,
      ttlSeconds: result.session.ttlSeconds,
      secure: this.config.isProduction,
    });
    return { mustChangePassword: result.mustChangePassword };
  }

  @AllowDuringPasswordChange()
  @AllowDuringTotpEnrollment()
  @SkipSessionRefresh()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.logout(user);
    clearSessionCookies(reply);
    return { ok: true };
  }

  @SkipSessionRefresh()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.logoutAll(user);
    clearSessionCookies(reply);
    return { ok: true };
  }

  @AllowDuringPasswordChange()
  @AllowDuringTotpEnrollment()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.buildMe(user);
  }

  @AllowDuringPasswordChange()
  @AllowDuringTotpEnrollment()
  @Throttle(AUTH_LOGIN_RATE_PER_MINUTE)
  @Post('password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(user, body);
    return { ok: true };
  }

  @AllowDuringTotpEnrollment()
  @Post('totp/setup')
  @HttpCode(200)
  setupTotp(@CurrentUser() user: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    return this.auth.setupTotp(user);
  }

  @AllowDuringTotpEnrollment()
  @Throttle(AUTH_LOGIN_RATE_PER_MINUTE)
  @Post('totp/confirm')
  @HttpCode(200)
  confirmTotp(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeInput,
  ): Promise<{ backupCodes: string[] }> {
    return this.auth.confirmTotp(user, body.code);
  }

  @Throttle(AUTH_LOGIN_RATE_PER_MINUTE)
  @Post('totp/disable')
  @HttpCode(200)
  async disableTotp(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeInput,
  ): Promise<{ ok: true }> {
    await this.auth.disableTotp(user, body.code);
    return { ok: true };
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser): Promise<SessionInfo[]> {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.auth.revokeSession(user, id);
    return { ok: true };
  }
}
