import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { AdminGuard } from './guards/admin.guard';

@Controller('admin')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  // H2: Strict rate limit — max 5 attempts per 60 seconds
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('login')
  login(@Body() adminLoginDto: AdminLoginDto) {
    return this.adminAuthService.login(adminLoginDto);
  }

  // H1: Refresh token endpoint — issue new access + refresh tokens
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  refresh(@Body() adminRefreshDto: AdminRefreshDto) {
    return this.adminAuthService.refresh(adminRefreshDto.refresh_token);
  }

  // H1: Logout — revoke refresh token
  @Post('logout')
  logout(@Body() adminRefreshDto: AdminRefreshDto) {
    return this.adminAuthService.logout(adminRefreshDto.refresh_token);
  }

  // H1: Logout all sessions — requires valid access token
  @UseGuards(AdminGuard)
  @Post('logout-all')
  logoutAll(@Request() req: { user: { id: string } }) {
    return this.adminAuthService.logoutAll(req.user.id);
  }
}
