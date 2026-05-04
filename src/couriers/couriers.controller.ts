import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { CouriersService } from './couriers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody } from '@nestjs/swagger';
import { RegisterCourierDto } from './dto/register-courier.dto';
import { UpdateCourierDto } from './dto/update-courier.dto';
import { AdminCreateCourierDto } from './dto/admin-create-courier.dto';

@ApiTags('Couriers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('couriers')
export class CouriersController {
  constructor(private readonly couriersService: CouriersService) {}

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
