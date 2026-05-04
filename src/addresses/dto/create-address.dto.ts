import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateAddressDto {
  @ApiProperty({ example: 'Home', description: 'Label for the address' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ example: -6.2088, description: 'Latitude coordinate' })
  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @ApiProperty({ example: 106.8456, description: 'Longitude coordinate' })
  @IsNumber()
  @IsNotEmpty()
  longitude: number;

  @ApiProperty({ example: 'Jl. Sudirman No. 1, Jakarta Selatan', description: 'Full address detail' })
  @IsString()
  @IsOptional()
  addressDetail?: string;

  @ApiProperty({ example: true, description: 'Set as primary address', default: false })
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}
