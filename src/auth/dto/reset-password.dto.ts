import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset token received from email link' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'user@example.com', description: 'Email address of the account' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'newSecurePassword123', description: 'New password (min 6 characters)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
