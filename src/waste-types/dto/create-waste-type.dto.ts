import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min, IsOptional, IsEnum } from 'class-validator';
import { WasteCategory } from '../../generated/prisma';

export class CreateWasteTypeDto {
  @ApiProperty({ example: 'Plastic', description: 'Name of the waste type' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: WasteCategory, example: 'MUTU', required: false, description: 'Category: MUTU or RESIDU' })
  @IsEnum(WasteCategory)
  @IsOptional()
  category?: WasteCategory;

  @ApiProperty({ example: 5000, description: 'Price per unit (kg/item)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  unitPrice: number;
}

