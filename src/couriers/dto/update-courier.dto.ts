import { ApiProperty, PartialType } from '@nestjs/swagger';
import { RegisterCourierDto } from './register-courier.dto';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateCourierDto extends PartialType(RegisterCourierDto) {
  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isOnline?: boolean;

  @ApiProperty({ example: -6.2088, required: false })
  @IsNumber()
  @IsOptional()
  currentLat?: number;

  @ApiProperty({ example: 106.8456, required: false })
  @IsNumber()
  @IsOptional()
  currentLng?: number;

  @ApiProperty({ example: 'B 1234 ABC', required: false, description: 'Plat nomor kendaraan' })
  @IsString()
  @IsOptional()
  vehiclePlate?: string;
}

