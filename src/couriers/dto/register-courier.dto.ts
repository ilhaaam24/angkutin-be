import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';

export enum VehicleType {
  MOTOR = 'MOTOR',
  PICKUP = 'PICKUP',
  TRUCK = 'TRUCK',
}

export class RegisterCourierDto {
  @ApiProperty({ enum: VehicleType, example: 'MOTOR', description: 'Type of vehicle used by the courier' })
  @IsEnum(VehicleType)
  @IsNotEmpty()
  vehicleType: VehicleType;
}
