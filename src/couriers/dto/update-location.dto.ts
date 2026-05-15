import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty } from 'class-validator';

export class UpdateLocationDto {
  @ApiProperty({ example: -7.2575, description: 'Latitude kurir saat ini' })
  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @ApiProperty({ example: 112.7521, description: 'Longitude kurir saat ini' })
  @IsNumber()
  @IsNotEmpty()
  longitude: number;
}
