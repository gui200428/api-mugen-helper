import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    // C1: Validate JWT_SECRET strength at startup
    if (!secret || secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be defined and at least 32 characters long',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // M5: sub is now a UUID string instead of numeric ID
  async validate(payload: { sub: string; email: string; role?: string }) {
    if (payload.role !== 'admin') {
      throw new UnauthorizedException('Admin access required');
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
    });

    if (!admin) {
      throw new UnauthorizedException();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = admin;
    return { ...result, role: 'admin' };
  }
}
