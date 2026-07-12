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
  CSRF_COOKIE,
  SESSION_COOKIE,
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
import { ConfigService } from '../../config/config.service';
import { AllowDuringPasswordChange } from '../../common/decorators/allow-password-change.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { CreatedSession } from './session.service';

@ApiTags('auth')
@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
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
    this.setCookies(reply, result.session);
    return { mustChangePassword: result.mustChangePassword };
  }

  @AllowDuringPasswordChange()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.logout(user);
    this.clearCookies(reply);
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.logoutAll(user);
    this.clearCookies(reply);
    return { ok: true };
  }

  @AllowDuringPasswordChange()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.buildMe(user);
  }

  @AllowDuringPasswordChange()
  @Post('password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ChangePasswordInput,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(user, body);
    return { ok: true };
  }

  @Post('totp/setup')
  @HttpCode(200)
  setupTotp(@CurrentUser() user: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    return this.auth.setupTotp(user);
  }

  @Post('totp/confirm')
  @HttpCode(200)
  confirmTotp(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeInput,
  ): Promise<{ backupCodes: string[] }> {
    return this.auth.confirmTotp(user, body.code);
  }

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

  private setCookies(reply: FastifyReply, session: CreatedSession): void {
    const secure = this.config.isProduction;
    void reply.setCookie(SESSION_COOKIE, session.sessionId, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: session.ttlSeconds,
    });
    // Readable by JS so the SPA can echo it in the X-CSRF-Token header (double submit).
    void reply.setCookie(CSRF_COOKIE, session.csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: session.ttlSeconds,
    });
  }

  private clearCookies(reply: FastifyReply): void {
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    void reply.clearCookie(CSRF_COOKIE, { path: '/' });
  }
}
