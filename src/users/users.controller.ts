import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')   // user management is admin-only
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // Overrides the controller-level admin restriction: any signed-in user may
  // read the minimal directory (used to pick a transfer recipient).
  @Get('directory')
  @Roles('admin', 'manager', 'employee')
  directory() {
    return this.usersService.directory();
  }
}
