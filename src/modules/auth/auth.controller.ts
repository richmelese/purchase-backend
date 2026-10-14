import { Controller, Get, Post, Body, Req, Res } from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService, COOKIE } from './auth.service.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AllowPendingPassword, CompanyAccess } from '../../common/decorators/account-scope.decorator.js';
import { AnyStaff } from '../../common/decorators/permission.decorator.js';

function sessionCookie(token: string, maxAgeMs: number | null, secure = false) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('status')
  async getStatus() {
    return this.authService.getStatus();
  }

  @Public()
  @Post('login')
  async login(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const result = await this.authService.login(body, req.ip);
    res.setHeader('Set-Cookie', sessionCookie(result.token, result.maxAge, isSecure));
    return { user: result.user };
  }

  @Public()
  @Post('signup')
  async signup(@Body() body: any) {
    return this.authService.signup(body);
  }

  @Public()
  @CompanyAccess()
  @AllowPendingPassword()
  @AnyStaff()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE] || '';
    await this.authService.logout(token);
    res.setHeader('Set-Cookie', clearCookie());
    return { ok: true };
  }

  @CompanyAccess()
  @AllowPendingPassword()
  @AnyStaff()
  @Get('me')
  async getMe(@CurrentUser() user: any) {
    return user;
  }

  @CompanyAccess()
  @AllowPendingPassword()
  @AnyStaff()
  @Post('password')
  async changePassword(@CurrentUser() user: any, @Body() body: any) {
    return this.authService.changeOwnPassword(user.id, body);
  }
}
