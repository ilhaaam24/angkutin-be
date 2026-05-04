import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { WasteTypesService } from './waste-types.service';
import { CreateWasteTypeDto } from './dto/create-waste-type.dto';
import { UpdateWasteTypeDto } from './dto/update-waste-type.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Waste Types')
@Controller('waste-types')
export class WasteTypesController {
  constructor(private readonly wasteTypesService: WasteTypesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new waste type (Admin)' })
  @ApiResponse({ status: 201, description: 'The waste type has been successfully created.' })
  @ApiBody({ type: CreateWasteTypeDto })
  create(@Body() createWasteTypeDto: CreateWasteTypeDto) {
    return this.wasteTypesService.create(createWasteTypeDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all waste types' })
  @ApiResponse({ status: 200, description: 'Return all waste types.' })
  findAll() {
    return this.wasteTypesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get waste type by id' })
  @ApiResponse({ status: 200, description: 'Return the waste type.' })
  @ApiResponse({ status: 404, description: 'Waste type not found.' })
  findOne(@Param('id') id: string) {
    return this.wasteTypesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a waste type (Admin)' })
  @ApiResponse({ status: 200, description: 'The waste type has been successfully updated.' })
  @ApiBody({ type: UpdateWasteTypeDto })
  update(@Param('id') id: string, @Body() updateWasteTypeDto: UpdateWasteTypeDto) {
    return this.wasteTypesService.update(id, updateWasteTypeDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a waste type (Admin)' })
  @ApiResponse({ status: 200, description: 'The waste type has been successfully deleted.' })
  remove(@Param('id') id: string) {
    return this.wasteTypesService.remove(id);
  }
}
