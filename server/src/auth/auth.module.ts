import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TenantModule } from '../tenant/tenant.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './google.strategy';
import { OauthExceptionFilter } from './oauth-exception.filter';

@Module({
  imports: [PassportModule, UsersModule, TenantModule],
  controllers: [AuthController],
  providers: [GoogleStrategy, OauthExceptionFilter],
})
export class AuthModule {}
