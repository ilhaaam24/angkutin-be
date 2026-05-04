import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { Role } from '../../generated/prisma';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'John Doe', description: 'User full name', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ enum: ['USER', 'COURIER', 'ADMIN'], default: 'USER', description: 'User role' })
  @IsEnum(['USER', 'COURIER', 'ADMIN'])
  @IsOptional()
  role?: Role;
}
