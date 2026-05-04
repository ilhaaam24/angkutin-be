import { Controller, Get, Post, Body, Patch, UseGuards, Request } from '@nestjs/common';
import { CouriersService } from './couriers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody } from '@nestjs/swagger';
import { RegisterCourierDto } from './dto/register-courier.dto';

@ApiTags('Couriers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('couriers')
export class CouriersController {
  constructor(private readonly couriersService: CouriersService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register as a courier' })
  @ApiResponse({ status: 201, description: 'Successfully registered as courier.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiBody({ type: RegisterCourierDto })
  register(@Request() req, @Body() registerCourierDto: RegisterCourierDto) {
    return this.couriersService.register(req.user.userId, registerCourierDto);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get courier profile' })
  @ApiResponse({ status: 200, description: 'Return courier profile details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getProfile(@Request() req) {
    return this.couriersService.getProfile(req.user.userId);
  }

  @Patch('status')
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
}
