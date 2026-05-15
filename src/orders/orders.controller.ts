import { Controller, Get, Post, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AiAnalyzeDto } from './dto/ai-analyze.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role, OrderStatus } from '../generated/prisma';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new waste collection order' })
  @ApiResponse({ status: 201, description: 'Order successfully created.' })
  @ApiBody({ type: CreateOrderDto })
  create(@Request() req, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(req.user.userId, createOrderDto);
  }

  @Post('ai-analyze')
  @ApiOperation({ summary: 'Analyze waste photo and save AI result (Mock)' })
  @ApiResponse({ status: 201, description: 'AI analysis successful and saved.' })
  @ApiBody({ type: AiAnalyzeDto })
  analyze(@Body() aiAnalyzeDto: AiAnalyzeDto) {
    return this.ordersService.analyzeAndSaveAiResult(aiAnalyzeDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders (filtered by role)' })
  @ApiResponse({ status: 200, description: 'Return orders based on user role.' })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  findAll(@Request() req, @Query('status') status?: OrderStatus) {
    return this.ordersService.findAllByRole(
      req.user.userId,
      req.user.role,
      status,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order details' })
  @ApiResponse({ status: 200, description: 'Return order details.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.ordersService.findOneByRole(id, req.user.userId, req.user.role);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get order status timeline' })
  @ApiResponse({ status: 200, description: 'Return order status history with labels.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  getTimeline(@Request() req, @Param('id') id: string) {
    return this.ordersService.getTimeline(id, req.user.userId, req.user.role);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an order (before weighing)' })
  @ApiResponse({ status: 200, description: 'Order cancelled.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { reason: { type: 'string', example: 'Berubah pikiran' } },
    },
  })
  cancel(@Request() req, @Param('id') id: string, @Body() data: { reason?: string }) {
    return this.ordersService.cancelOrder(id, req.user.userId, req.user.role, data.reason);
  }

  @Get(':id/tracking')
  @ApiOperation({ summary: 'Get latest courier location for an order (fallback)' })
  @ApiResponse({ status: 200, description: 'Return latest courier location.' })
  getTracking(@Request() req, @Param('id') id: string) {
    return this.ordersService.getLatestTracking(id, req.user.userId, req.user.role);
  }

  @Get(':id/tracking/history')
  @ApiOperation({ summary: 'Get full tracking history for an order' })
  @ApiResponse({ status: 200, description: 'Return all tracking points.' })
  getTrackingHistory(@Param('id') id: string) {
    return this.ordersService.getTrackingHistory(id);
  }
}
