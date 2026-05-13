import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

// H2: Account lockout configuration
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 15;

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  // I2: Pre-computed valid bcrypt hash for timing attack mitigation
  private readonly DUMMY_HASH =
    '$2b$10$eVlRdvPeBNTq28k/c6UyuuROgMjDNtfy./ZwngOnrmOSog9iij8qW';

  // Refresh token validity (7 days)
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 7;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(adminLoginDto: AdminLoginDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: adminLoginDto.email },
    });

    if (!admin) {
      // I2: Use valid bcrypt hash to prevent timing-based user enumeration
      await bcrypt.compare(adminLoginDto.password, this.DUMMY_HASH);
      this.logger.warn(
        `Failed login attempt for non-existent email: ${adminLoginDto.email}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // H2: Check if account is locked
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const remainingMs = admin.lockedUntil.getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      this.logger.warn(
        `Login attempt on locked account: ${admin.email} (locked for ${remainingMin} more min)`,
      );
      throw new ForbiddenException(
        `Account temporarily locked. Try again in ${remainingMin} minute(s).`,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      adminLoginDto.password,
      admin.password,
    );

    if (!isPasswordValid) {
      // H2: Increment failed attempts and potentially lock account
      const newFailedAttempts = admin.failedLoginAttempts + 1;
      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = {
        failedLoginAttempts: newFailedAttempts,
      };

      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockedUntil = new Date(
          Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000,
        );
        this.logger.warn(
          `Account locked due to ${newFailedAttempts} failed attempts: ${admin.email}`,
        );
      }

      await this.prisma.admin.update({
        where: { id: admin.id },
        data: updateData,
      });

      this.logger.warn(
        `Failed login attempt #${newFailedAttempts} for: ${admin.email}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // H2: Reset failed attempts on successful login
    if (admin.failedLoginAttempts > 0 || admin.lockedUntil) {
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    // H1: Generate short-lived access token + long-lived refresh token
    const accessToken = this.generateAccessToken(
      admin.id,
      admin.email,
      admin.name,
    );
    const refreshToken = await this.generateRefreshToken(admin.id);

    this.logger.log(`Successful login: ${admin.email}`);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    // H1: Validate refresh token and issue new access token
    const tokenHash = this.hashToken(refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { admin: true },
    });

    if (!storedToken) {
      this.logger.warn('Refresh attempt with invalid token');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      // Clean up expired token
      await this.prisma.refreshToken.deleteMany({
        where: { id: storedToken.id },
      });
      this.logger.warn(
        `Refresh attempt with expired token for admin: ${storedToken.admin.email}`,
      );
      throw new UnauthorizedException('Refresh token expired');
    }

    // Rotate: delete old token and create a new one
    await this.prisma.refreshToken.deleteMany({
      where: { id: storedToken.id },
    });

    const newAccessToken = this.generateAccessToken(
      storedToken.admin.id,
      storedToken.admin.email,
      storedToken.admin.name,
    );
    const newRefreshToken = await this.generateRefreshToken(
      storedToken.admin.id,
    );

    this.logger.log(`Token refreshed for admin: ${storedToken.admin.email}`);

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    };
  }

  async logout(refreshToken: string) {
    // H1: Revoke refresh token on logout
    const tokenHash = this.hashToken(refreshToken);

    const deleted = await this.prisma.refreshToken
      .delete({
        where: { tokenHash },
      })
      .catch(() => null);

    if (deleted) {
      this.logger.log(
        `Logout: refresh token revoked for admin ${deleted.adminId}`,
      );
    }

    return { message: 'Logged out successfully' };
  }

  async logoutAll(adminId: string) {
    // Revoke ALL refresh tokens for an admin (emergency use)
    const result = await this.prisma.refreshToken.deleteMany({
      where: { adminId },
    });

    this.logger.warn(
      `Logout all: ${result.count} refresh tokens revoked for admin ${adminId}`,
    );

    return { message: `Revoked ${result.count} session(s)` };
  }

  // --- Private helpers ---

  private generateAccessToken(
    adminId: string,
    email: string,
    name: string,
  ): string {
    const payload = {
      email,
      name,
      sub: adminId,
      role: 'admin',
    };
    return this.jwtService.sign(payload);
  }

  private async generateRefreshToken(adminId: string): Promise<string> {
    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        adminId,
        expiresAt,
      },
    });

    return rawToken;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
