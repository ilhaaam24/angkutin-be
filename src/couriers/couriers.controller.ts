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
import { UpdateLocationDto } from './dto/update-location.dto';
import { SubmitWeighingDto } from '../orders/dto/submit-weighing.dto';
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
  
  @Patch('location')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Update general courier GPS location' })
  @ApiResponse({ status: 200, description: 'Location successfully updated.' })
  updateGeneralLocation(@Request() req, @Body() data: UpdateLocationDto) {
    return this.couriersService.updateLocation(req.user.userId, data.latitude, data.longitude);
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
  @ApiOperation({ summary: 'Accept order and wait for departure' })
  async acceptOrder(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.acceptOrder(id, courier!.id);
  }

  @Post('orders/:id/depart')
  @Roles(Role.COURIER)
  @ApiOperation({ summary: 'Courier departs heading to pickup location' })
  async departOrder(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.transitionOrderStatus(
      id, courier!.id, OrderStatus.ON_GOING, 'Kurir berangkat menuju lokasi',
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
  @ApiOperation({ summary: 'Start weighing waste (auto-generates random weights)' })
  @ApiResponse({ status: 200, description: 'Random weights generated. Returns mutuWeight and residualWeight.' })
  async startWeighing(@Request() req, @Param('id') id: string) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    return this.ordersService.startWeighing(id, courier!.id);
  }

  @Post('orders/:id/weigh')
  @Roles(Role.COURIER)
  @UseInterceptors(FileInterceptor('photo'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Submit waste type selection and photo (weights auto-generated from start-weighing)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        wasteTypeId: { 
          type: 'string', 
          description: 'UUID jenis sampah MUTU yang dipilih kurir. Dapatkan daftar dari GET /waste-types',
          example: 'uuid-waste-type-id',
        },
        photo: { type: 'string', format: 'binary', description: 'Bukti foto sampah' },
      },
      required: ['wasteTypeId'],
    },
  })
  async weighOrder(
    @Request() req,
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const courier = await this.couriersService.getProfile(req.user.userId);
    
    const data: SubmitWeighingDto = {
      wasteTypeId: body.wasteTypeId,
    };

    let photoUrl: string | undefined;
    if (file) {
      photoUrl = await this.uploadService.uploadImage(file.buffer, 'residuals','waste');
    }

    return this.ordersService.submitWeighing(id, courier!.id, data, photoUrl);
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
    
    // 1. Upload ke bucket 'angkutin_bucket' folder 'orders'
    const photoUrl = await this.uploadService.uploadImage(file.buffer, 'completed', 'orders');

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
