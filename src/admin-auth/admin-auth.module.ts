import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminJwtStrategy } from './admin-jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');

        // C1: Validate JWT_SECRET strength at startup
        if (!secret || secret.length < 32) {
          throw new Error(
            'JWT_SECRET must be defined and at least 32 characters long. ' +
              "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
          );
        }

        return {
          secret,
          // H1: Reduced access token expiration from 8h to 15 minutes
          signOptions: { expiresIn: '15m' },
        };
      },
    }),
  ],
  providers: [AdminAuthService, AdminJwtStrategy],
  controllers: [AdminAuthController],
  exports: [JwtModule],
})
export class AdminAuthModule {}
