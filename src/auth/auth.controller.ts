import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  // Stricter cap than the global one: this is the brute-force-sensitive endpoint.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /** The current user's profile ({ id, email, full_name, role }), resolved from
   *  the bearer token. Lets the frontend show the real user, not a stub. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser('id') id: number) {
    return this.usersService.findOneBasic(id);
  }
}
