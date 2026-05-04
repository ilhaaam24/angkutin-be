import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested, IsUUID, IsNumber, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ScheduleType } from '../../generated/prisma';

class WasteItemDto {
  @ApiProperty({ example: 'uuid-waste-type-id' })
  @IsUUID()
  @IsNotEmpty()
  wasteTypeId: string;

  @ApiProperty({ example: 2.5, description: 'Weight in kg' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.1)
  weight: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'uuid-address-id' })
  @IsUUID()
  @IsNotEmpty()
  addressId: string;

  @ApiProperty({ enum: ['INSTANT', 'SCHEDULED'], example: 'INSTANT' })
  @IsEnum(['INSTANT', 'SCHEDULED'])
  @IsNotEmpty()
  scheduleType: ScheduleType;

  @ApiProperty({ example: '2026-04-28T10:00:00Z', required: false })
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @ApiProperty({ example: 'Please pick up near the gate', required: false })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ type: [WasteItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WasteItemDto)
  wasteItems: WasteItemDto[];
}
