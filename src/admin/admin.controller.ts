import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AdminUpdateUserDto } from './dto/update-user.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';
import { AdminCreateWasteTypeDto } from './dto/create-waste-type.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ============================================
  // 1. DASHBOARD & ANALYTICS
  // ============================================

  @Get('analytics/summary')
  @ApiOperation({ summary: 'Get dashboard analytics summary' })
  @ApiResponse({
    status: 200,
    description: 'Return analytics summary: totalOrders, totalRevenue, totalMutuKg, totalResiduKg, activeCouriers, pendingWithdrawals.',
  })
  getAnalyticsSummary() {
    return this.adminService.getAnalyticsSummary();
  }

  @Get('analytics/charts')
  @ApiOperation({ summary: 'Get analytics chart data (Bar: Mutu vs Residu, Area: Revenue vs Beban)' })
  @ApiQuery({ name: 'range', required: false, enum: ['7d', '30d'], description: 'Time range for chart data' })
  @ApiResponse({
    status: 200,
    description: 'Return barChart and areaChart data arrays.',
  })
  getAnalyticsCharts(@Query('range') range?: '7d' | '30d') {
    return this.adminService.getAnalyticsCharts(range || '7d');
  }

  // ============================================
  // 2. USER MANAGEMENT
  // ============================================

  @Get('users')
  @ApiOperation({ summary: 'Get all users (Customer, Courier, Admin)' })
  @ApiResponse({ status: 200, description: 'Return all users with order counts.' })
  getAllUsers() {
    return this.adminService.getAllUsers();
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user data or change status (Aktif/Suspend)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiBody({ type: AdminUpdateUserDto })
  @ApiResponse({ status: 200, description: 'User successfully updated.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  updateUser(@Param('id') id: string, @Body() data: AdminUpdateUserDto) {
    return this.adminService.updateUser(id, data);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete user permanently' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User and all associated data successfully deleted.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // ============================================
  // 3. FINANCE & WITHDRAWALS
  // ============================================

  @Get('finance/transactions')
  @ApiOperation({ summary: 'Get global transaction history' })
  @ApiResponse({ status: 200, description: 'Return all wallet transactions with user data.' })
  getTransactions() {
    return this.adminService.getTransactions();
  }

  @Get('finance/withdrawals')
  @ApiOperation({ summary: 'Get all withdrawal requests' })
  @ApiResponse({ status: 200, description: 'Return all withdrawals with user data.' })
  getWithdrawals() {
    return this.adminService.getWithdrawals();
  }

  @Post('finance/withdrawals/:id/approve')
  @ApiOperation({ summary: 'Approve a pending withdrawal' })
  @ApiParam({ name: 'id', description: 'Withdrawal UUID' })
  @ApiResponse({ status: 200, description: 'Withdrawal approved and processed.' })
  @ApiResponse({ status: 404, description: 'Withdrawal not found.' })
  @ApiResponse({ status: 400, description: 'Only PENDING withdrawals can be approved.' })
  approveWithdrawal(@Param('id') id: string) {
    return this.adminService.approveWithdrawal(id);
  }

  @Post('finance/withdrawals/:id/reject')
  @ApiOperation({ summary: 'Reject a pending withdrawal with reason' })
  @ApiParam({ name: 'id', description: 'Withdrawal UUID' })
  @ApiBody({ type: RejectWithdrawalDto })
  @ApiResponse({ status: 200, description: 'Withdrawal rejected and balance refunded.' })
  @ApiResponse({ status: 404, description: 'Withdrawal not found.' })
  @ApiResponse({ status: 400, description: 'Only PENDING withdrawals can be rejected.' })
  rejectWithdrawal(
    @Param('id') id: string,
    @Body() data: RejectWithdrawalDto,
  ) {
    return this.adminService.rejectWithdrawal(id, data.reason);
  }

  // ============================================
  // 4. WASTE PRICING
  // ============================================

  @Get('waste-types')
  @ApiOperation({ summary: 'Get all waste types with pricing (grouped by MUTU/RESIDU)' })
  @ApiResponse({ status: 200, description: 'Return waste types with latest pricing data.' })
  getWasteTypes() {
    return this.adminService.getWasteTypes();
  }

  @Post('waste-types')
  @ApiOperation({ summary: 'Create a new waste type with category' })
  @ApiBody({ type: AdminCreateWasteTypeDto })
  @ApiResponse({ status: 201, description: 'Waste type successfully created.' })
  createWasteType(@Body() data: AdminCreateWasteTypeDto) {
    return this.adminService.createWasteType(data);
  }

  // ============================================
  // 5. FLEET & LIVE MONITORING
  // ============================================

  @Get('fleet/locations')
  @ApiOperation({ summary: 'Get current courier locations and active task status' })
  @ApiResponse({
    status: 200,
    description: 'Return online couriers with coordinates, vehicle info, and active order.',
  })
  getFleetLocations() {
    return this.adminService.getFleetLocations();
  }

  // ============================================
  // 6. ORDERS MANAGEMENT (Bonus)
  // ============================================

  @Get('orders/summary')
  @ApiOperation({ summary: 'Get orders count summary by status' })
  @ApiResponse({ status: 200, description: 'Return order counts grouped by status.' })
  getOrdersSummary() {
    return this.adminService.getOrdersSummary();
  }
}
