import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { CouriersService } from './couriers.service';
import { OrdersService } from '../orders/orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role, OrderStatus } from '../generated/prisma';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { RegisterCourierDto } from './dto/register-courier.dto';
import { UpdateCourierDto } from './dto/update-courier.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from '../upload/upload.service';

@ApiTags('Couriers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('couriers')
export class CouriersController {
  constructor(
    private readonly couriersService: CouriersService,
    private readonly ordersService: OrdersService,
    private readonly uploadService: UploadService,
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
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Complete the order with photo evidence' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  async completeOrder(
    @Request() req,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Bukti foto (file) wajib diunggah saat menyelesaikan pesanan');
    }

    const courier = await this.couriersService.getProfile(req.user.userId);
    
    // 1. Upload ke bucket 'waste' folder 'orders'
    const photoUrl = await this.uploadService.uploadImage(file.buffer, 'orders', 'waste');

    // 2. Transisi status
    return this.ordersService.transitionOrderStatus(
      id,
      courier!.id,
      OrderStatus.COMPLETED,
      'Pesanan selesai dengan bukti foto',
      photoUrl,
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
}
