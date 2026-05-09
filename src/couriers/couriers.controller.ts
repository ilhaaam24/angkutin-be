import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { CouriersService } from './couriers.service';
import { OrdersService } from '../orders/orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role, OrderStatus } from '../generated/prisma';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { RegisterCourierDto } from './dto/register-courier.dto';
import { UpdateCourierDto } from './dto/update-courier.dto';
import { AdminCreateCourierDto } from './dto/admin-create-courier.dto';

@ApiTags('Couriers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('couriers')
export class CouriersController {
  constructor(
    private readonly couriersService: CouriersService,
    private readonly ordersService: OrdersService,
  ) {}

  // --- COURIER ENDPOINTS (Statis harus di atas dynamic) ---

  @Post('register')
  @Roles(Role.USER)
  @ApiOperation({ summary: 'Register as a courier' })
  @ApiResponse({ status: 201, description: 'Successfully registered as courier.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiBody({ type: RegisterCourierDto })
  register(@Request() req, @Body() registerCourierDto: RegisterCourierDto) {
    return this.couriersService.register(req.user.userId, registerCourierDto);
  }

  @Get('profile')
  @Roles(Role.COURIER, Role.ADMIN)
  @ApiOperation({ summary: 'Get current courier profile' })
  @ApiResponse({ status: 200, description: 'Return courier profile details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getProfile(@Request() req) {
    return this.couriersService.getProfile(req.user.userId);
  }

  @Patch('status')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Update online/offline status' })
  @ApiResponse({ status: 200, description: 'Status successfully updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isOnline: { type: 'boolean', example: true },
      },
    },
  })
  updateStatus(@Request() req, @Body() data: { isOnline: boolean }) {
    return this.couriersService.updateStatus(req.user.userId, data.isOnline);
  }

  @Patch('vehicle')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Update courier vehicle type' })
  @ApiResponse({ status: 200, description: 'Vehicle type successfully updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        vehicleType: { type: 'string', example: 'MOTOR' },
      },
    },
  })
  updateVehicle(@Request() req, @Body() data: { vehicleType: any }) {
    return this.couriersService.updateVehicle(req.user.userId, data.vehicleType);
  }

  // --- COURIER ORDER ENDPOINTS ---

  @Get('orders')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Get orders assigned to current courier' })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  async getMyOrders(@Request() req, @Query('status') status?: OrderStatus) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.getCourierOrders(courier!.id, status);
  }

  @Get('available-orders')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Get unassigned orders available for pickup' })
  async getAvailableOrders() {
    return this.ordersService.getAvailableOrders();
  }

  @Get('orders/:id')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Get order detail for courier' })
  async getOrderDetail(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.findOneForCourier(id, courier!.id);
  }

  @Post('orders/:id/accept')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Accept order and start heading to pickup location' })
  async acceptOrder(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.transitionOrderStatus(
      id, courier!.id, OrderStatus.ON_GOING, 'Kurir menuju lokasi penjemputan',
    );
  }

  @Post('orders/:id/reject')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Reject order, triggers reassignment' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { reason: { type: 'string', example: 'Terlalu jauh' } },
    },
  })
  async rejectOrder(@Request() req, @Param('id') id: string, @Body() data: { reason?: string }) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.rejectOrder(id, courier!.id, data.reason);
  }

  @Post('orders/:id/arrive')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Courier arrived at pickup location' })
  async arriveOrder(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.transitionOrderStatus(
      id, courier!.id, OrderStatus.ARRIVED, 'Kurir tiba di lokasi',
    );
  }

  @Post('orders/:id/start-weighing')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Start weighing waste' })
  async startWeighing(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.transitionOrderStatus(
      id, courier!.id, OrderStatus.WEIGHING, 'Proses penimbangan sampah dimulai',
    );
  }

  @Post('orders/:id/pickup')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Waste picked up and loaded' })
  async pickupOrder(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.transitionOrderStatus(
      id, courier!.id, OrderStatus.PICKED_UP, 'Sampah berhasil diangkut',
    );
  }

  @Post('orders/:id/deliver')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Start delivering to recycling drop point' })
  async deliverOrder(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.transitionOrderStatus(
      id, courier!.id, OrderStatus.DELIVERING, 'Kurir menuju drop point daur ulang',
    );
  }

  @Post('orders/:id/complete')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Complete the order' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photoUrl: { type: 'string', example: 'https://example.com/photo.jpg' },
      },
    },
  })
  async completeOrder(
    @Request() req,
    @Param('id') id: string,
    @Body() data: { photoUrl?: string },
  ) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.transitionOrderStatus(
      id,
      courier!.id,
      OrderStatus.COMPLETED,
      'Pesanan selesai',
      data.photoUrl,
    );
  }

  @Post('orders/:id/location')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Update courier location for an active order' })
  @ApiResponse({ status: 201, description: 'Location updated and broadcasted.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', example: -7.2575 },
        longitude: { type: 'number', example: 112.7521 },
      },
      required: ['latitude', 'longitude'],
    },
  })
  async updateLocation(
    @Request() req,
    @Param('id') id: string,
    @Body() data: { latitude: number; longitude: number },
  ) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.updateCourierLocation(
      id, courier!.id, data.latitude, data.longitude,
    );
  }

  // --- ADMIN ENDPOINTS (Dynamic :id diletakkan di bawah) ---

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get all couriers (Admin only)' })
  @ApiResponse({ status: 200, description: 'Return all couriers.' })
  findAll() {
    return this.couriersService.findAll();
  }

  @Get(':id/detail')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get courier detail by ID (Admin only)' })
  @ApiResponse({ status: 200, description: 'Return courier detail.' })
  findOne(@Param('id') id: string) {
    return this.couriersService.findOne(id);
  }

  @Post('admin')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create new courier OR Promote existing user (Admin only)' })
  @ApiBody({ type: AdminCreateCourierDto })
  adminCreate(@Body() adminCreateCourierDto: AdminCreateCourierDto) {
    return this.couriersService.adminCreate(adminCreateCourierDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update courier details (Admin only)' })
  @ApiBody({ type: UpdateCourierDto })
  update(@Param('id') id: string, @Body() updateCourierDto: UpdateCourierDto) {
    return this.couriersService.adminUpdate(id, updateCourierDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Remove courier (Admin only)' })
  remove(@Param('id') id: string) {
    return this.couriersService.remove(id);
  }
}
