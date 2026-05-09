import { Controller, Get, Body, Patch, Post, Delete, Param, UseGuards, Request, UseInterceptors, UploadedFile } from '@nestjs/common';
import { UsersService } from './users.service';
import { AddressesService } from '../addresses/addresses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { CreateAddressDto } from '../addresses/dto/create-address.dto';
import { UpdateAddressDto } from '../addresses/dto/update-address.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from '../upload/upload.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly addressesService: AddressesService,
    private readonly uploadService: UploadService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Return current user profile.' })
  async getProfile(@Request() req) {
    const user = await this.usersService.findOneById(req.user.userId);
    if (user) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile successfully updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiBody({ type: UpdateProfileDto })
  async updateProfile(@Request() req, @Body() updateProfileDto: UpdateProfileDto) {
    return this.usersService.update(req.user.userId, updateProfileDto);
  }

  @Post('profile-pic')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload profile picture' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadProfilePic(@Request() req, @UploadedFile() file: Express.Multer.File) {
    const user = await this.usersService.findOneById(req.user.userId);
    
    // Delete old image from bucket if it exists
    if (user?.photoUrl) {
      await this.uploadService.deleteImageByUrl(user.photoUrl, 'profile_pic');
    }

    const photoUrl = await this.uploadService.uploadImage(file.buffer, 'profiles');
    await this.usersService.update(req.user.userId, { photoUrl });
    return { photoUrl };
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get all user addresses' })
  @ApiResponse({ status: 200, description: 'Return all addresses for the authenticated user.' })
  async getAddresses(@Request() req) {
    return this.addressesService.findAll(req.user.userId);
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Add a new address' })
  @ApiResponse({ status: 201, description: 'Address successfully created.' })
  @ApiBody({ type: CreateAddressDto })
  async addAddress(@Request() req, @Body() createAddressDto: CreateAddressDto) {
    return this.addressesService.create(req.user.userId, createAddressDto);
  }

  @Patch('addresses/:id')
  @ApiOperation({ summary: 'Update address' })
  @ApiResponse({ status: 200, description: 'Address successfully updated.' })
  @ApiBody({ type: UpdateAddressDto })
  async updateAddress(@Request() req, @Param('id') id: string, @Body() updateAddressDto: UpdateAddressDto) {
    return this.addressesService.update(id, req.user.userId, updateAddressDto);
  }

  @Delete('addresses/:id')
  @ApiOperation({ summary: 'Remove address' })
  @ApiResponse({ status: 200, description: 'Address successfully removed.' })
  async removeAddress(@Request() req, @Param('id') id: string) {
    return this.addressesService.remove(id, req.user.userId);
  }
}
