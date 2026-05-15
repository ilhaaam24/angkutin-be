import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Addresses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new address' })
  @ApiResponse({ status: 201, description: 'Address successfully created.' })
  create(@Request() req, @Body() createAddressDto: CreateAddressDto) {
    return this.addressesService.create(req.user.userId, createAddressDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all user addresses' })
  @ApiResponse({ status: 200, description: 'Return all addresses for the logged-in user.' })
  findAll(@Request() req) {
    return this.addressesService.findAll(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get address details' })
  @ApiResponse({ status: 200, description: 'Return address details.' })
  @ApiResponse({ status: 404, description: 'Address not found.' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.addressesService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update address' })
  @ApiResponse({ status: 200, description: 'Address successfully updated.' })
  update(@Request() req, @Param('id') id: string, @Body() updateAddressDto: UpdateAddressDto) {
    return this.addressesService.update(id, req.user.userId, updateAddressDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove address' })
  @ApiResponse({ status: 200, description: 'Address successfully removed.' })
  remove(@Request() req, @Param('id') id: string) {
    return this.addressesService.remove(id, req.user.userId);
  }
}
