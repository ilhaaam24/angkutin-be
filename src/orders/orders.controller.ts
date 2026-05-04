import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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

  @Get()
  @ApiOperation({ summary: 'Get all my orders' })
  @ApiResponse({ status: 200, description: 'Return all orders for current user.' })
  findAll(@Request() req) {
    return this.ordersService.findAll(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order details' })
  @ApiResponse({ status: 200, description: 'Return order details.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.ordersService.findOne(id, req.user.userId);
  }
}
