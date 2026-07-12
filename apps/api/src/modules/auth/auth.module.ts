import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    LockoutService,
    TotpService,
    CryptoService,
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
