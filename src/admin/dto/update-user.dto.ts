import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { UserStatus } from '../../generated/prisma';

export class AdminUpdateUserDto {
  @ApiProperty({ example: 'John Doe', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: '081234567890', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ enum: UserStatus, example: 'SUSPENDED', required: false })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;
}
