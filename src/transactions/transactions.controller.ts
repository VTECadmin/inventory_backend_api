import { Controller, Get, Header, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('itemId') itemId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('itemSearch') itemSearch?: string,
    @Query('action') action?: string,
  ) {
    // With a page, return one paginated page (the history table) with optional
    // filters; otherwise return all matching rows (item detail, recent activity).
    if (page) {
      return this.transactionsService.findPage(user, {
        page: Number(page),
        limit: limit ? Number(limit) : 50,
        userId: userId ? Number(userId) : undefined,
        itemSearch: itemSearch || undefined,
        action: action || undefined,
      });
    }
    return this.transactionsService.findAll(user, {
      itemId: itemId ? Number(itemId) : undefined,
      userId: userId ? Number(userId) : undefined,
    });
  }

  @Get('my-borrows')
  myBorrows(@CurrentUser() user: AuthUser) {
    return this.transactionsService.myBorrows(user);
  }

  // Admin only: what a given user currently holds (active borrows).
  @Get('holdings/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  holdings(@Param('userId', ParseIntPipe) userId: number) {
    return this.transactionsService.holdingsOf(userId);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="history.csv"')
  exportCsv(
    @CurrentUser() user: AuthUser,
    @Query('userId') userId?: string,
    @Query('itemSearch') itemSearch?: string,
    @Query('action') action?: string,
  ) {
    return this.transactionsService.exportCsv(user, {
      userId: userId ? Number(userId) : undefined,
      itemSearch: itemSearch || undefined,
      action: action || undefined,
    });
  }

  @Post(':id/undo')
  undo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.transactionsService.undoTransaction(id, user);
  }
}
