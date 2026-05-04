import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { VehicleType } from '../../generated/prisma';

export class AdminCreateCourierDto {
  @ApiProperty({ example: 'uuid-user-id', required: false, description: 'Optional: Use this if user already exists' })
  @IsUUID()
  @IsOptional()
  userId?: string;

  @ApiProperty({ example: 'courier@example.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: 'password123', required: false })
  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @ApiProperty({ example: 'Courier Name', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: '08123456789', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ enum: VehicleType, example: 'MOTOR' })
  @IsEnum(VehicleType)
  @IsNotEmpty()
  vehicleType: VehicleType;
}
