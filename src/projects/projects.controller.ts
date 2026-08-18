import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { NameDto } from '../inventory/dto/name.dto';
import { ReleaseItemsDto } from './dto/release-items.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id/items')
  items(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.items(id);
  }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: NameDto, @CurrentUser() user: AuthUser) {
    return this.projectsService.create(dto.name, user.id);
  }

  @Post(':id/release')
  @Roles('admin', 'manager')
  release(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReleaseItemsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.releaseItems(id, user.id, dto.itemIds);
  }

  @Post(':id/release-all')
  @Roles('admin', 'manager')
  releaseAll(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.projectsService.releaseAll(id, user.id);
  }
}
