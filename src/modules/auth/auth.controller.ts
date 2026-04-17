import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthUserDto } from './dto/auth-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { getCookieValue } from '../../common/http/cookie.util';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface RefreshResult {
  refreshed: boolean;
}

interface LogoutResult {
  loggedOut: boolean;
}

interface OAuthUrlResult {
  url: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserDto> {
    const { user, tokens } = await this.authService.login(dto);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return user;
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new client and their company' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserDto> {
    const { user, tokens } = await this.authService.register(dto);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return user;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResult> {
    const refreshToken = getCookieValue(req.cookies, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      this.clearAuthCookies(res);
      return { refreshed: false };
    }

    const tokens = await this.authService.refreshToken(refreshToken);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { refreshed: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Logout and clear auth cookies' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResult> {
    const token = getCookieValue(req.cookies, ACCESS_TOKEN_COOKIE);
    if (token) {
      await this.authService.logout(token);
    }
    this.clearAuthCookies(res);
    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Get('oauth/google')
  @ApiOperation({ summary: 'Get Google OAuth redirect URL' })
  googleOAuth(): OAuthUrlResult {
    return { url: this.authService.getOAuthUrl('google') };
  }

  @Post('oauth/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a Supabase OAuth access token for a session cookie',
  })
  async oauthCallback(
    @Query('access_token') accessToken: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserDto> {
    const { user, tokens } =
      await this.authService.handleOAuthCallback(accessToken);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return user;
  }

  private baseCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('nodeEnv') === 'production',
      sameSite: 'strict',
      path: '/',
    };
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string | undefined,
  ): void {
    const base = this.baseCookieOptions();
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...base,
      maxAge: ACCESS_TOKEN_TTL_MS,
    });
    if (refreshToken) {
      res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
        ...base,
        maxAge: REFRESH_TOKEN_TTL_MS,
      });
    }
  }

  private clearAuthCookies(res: Response): void {
    const base = this.baseCookieOptions();
    res.clearCookie(ACCESS_TOKEN_COOKIE, base);
    res.clearCookie(REFRESH_TOKEN_COOKIE, base);
  }
}
