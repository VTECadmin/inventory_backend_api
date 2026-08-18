import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { ItemActionDto } from './dto/item-action.dto';
import { TransferDto } from './dto/transfer.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { NameDto } from './dto/name.dto';
import { ImportCsvDto } from './dto/import-csv.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { ReassignDeleteDto } from './dto/reassign-delete.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  findAll(
    @Query('location') location?: string,
    @Query('search') search?: string,
    @Query('lowStock') lowStock?: string,
    @Query('calibrationDue') calibrationDue?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.findAll({
      location,
      search,
      lowStock: lowStock === 'true',
      calibrationDue: calibrationDue === 'true',
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('locations')
  getLocations() {
    return this.inventoryService.getLocations();
  }

  @Get('low-stock/count')
  getLowStockCount() {
    return this.inventoryService.getLowStockCount();
  }

  @Get('calibration-due/count')
  getCalibrationDueCount() {
    return this.inventoryService.getCalibrationDueCount();
  }

  @Get('categories')
  getCategories() {
    return this.inventoryService.getCategories();
  }

  // ── List management (locations & categories) ──
  @Post('locations')
  @Roles('admin', 'manager')
  createLocation(@Body() dto: NameDto) {
    return this.inventoryService.createLocation(dto.name);
  }

  @Delete('locations/:id')
  @Roles('admin', 'manager')
  deleteLocation(
    @Param('id', ParseIntPipe) id: number,
    @Query('force') force?: string,
    @Query('targetLocationId') targetLocationId?: string,
  ) {
    return this.inventoryService.deleteLocation(
      id,
      force === 'true',
      targetLocationId ? Number(targetLocationId) : undefined,
    );
  }

  // Force-delete a location, moving each item to a chosen destination.
  @Post('locations/:id/reassign-delete')
  @Roles('admin', 'manager')
  reassignDeleteLocation(@Param('id', ParseIntPipe) id: number, @Body() dto: ReassignDeleteDto) {
    return this.inventoryService.reassignAndDeleteLocation(id, dto.assignments);
  }

  @Post('categories')
  @Roles('admin', 'manager')
  createCategory(@Body() dto: NameDto) {
    return this.inventoryService.createCategory(dto.name);
  }

  @Delete('categories/:id')
  @Roles('admin', 'manager')
  deleteCategory(
    @Param('id', ParseIntPipe) id: number,
    @Query('force') force?: string,
    @Query('targetCategoryId') targetCategoryId?: string,
  ) {
    return this.inventoryService.deleteCategory(
      id,
      force === 'true',
      targetCategoryId ? Number(targetCategoryId) : undefined,
    );
  }

  // ── CSV import ──
  @Post('import')
  @Roles('admin', 'manager')
  importCsv(@Body() dto: ImportCsvDto, @CurrentUser() user: AuthUser) {
    return this.inventoryService.importCsv(dto.csv, user.id);
  }

  @Get('export')
  @Roles('admin', 'manager')   // employees get 403
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="inventory.csv"')
  exportCsv(@Query('location') location?: string, @Query('search') search?: string) {
    return this.inventoryService.exportCsv({ location, search });
  }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateItemDto) {
    return this.inventoryService.createItem(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.inventoryService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateItemDto) {
    return this.inventoryService.updateItem(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.inventoryService.deleteItem(id);
  }

  @Post(':id/take')
  take(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ItemActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventoryService.take(id, user.id, dto.qty ?? 1, dto.notes);
  }

  @Post(':id/borrow')
  borrow(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ItemActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventoryService.borrow(id, user.id, dto.qty ?? 1, dto.notes);
  }

  @Post(':id/return')
  returnItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ItemActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventoryService.returnItem(id, user.id, dto.qty ?? 1, dto.notes, dto.borrowId);
  }

  @Post(':id/breakdown')
  breakdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ItemActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventoryService.breakdown(id, user.id, dto.qty ?? 1, dto.notes, dto.borrowId);
  }

  @Post(':id/transfer')
  transfer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransferDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventoryService.transfer(id, user.id, dto.toUserId, dto.qty ?? 1, dto.notes, dto.borrowId);
  }

  @Post(':id/assign')
  @Roles('admin', 'manager')
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventoryService.assignToProject(id, user.id, dto.projectId);
  }

  @Post(':id/release')
  @Roles('admin', 'manager')
  release(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.inventoryService.releaseFromProject(id, user.id);
  }
}
