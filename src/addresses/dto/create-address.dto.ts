import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateAddressDto {
  @ApiProperty({ example: 'Home', description: 'Label for the address' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ example: 'Sukolilo', description: 'District' })
  @IsString()
  @IsNotEmpty()
  district: string;

  @ApiProperty({ example: 'Semolowaru', description: 'Village' })
  @IsString()
  @IsNotEmpty()
  village: string;

  @ApiProperty({ example: 'Jl. Semolowaru Utara 1 No 110B, RT 01 RW 02', description: 'Full address detail' })
  @IsString()
  @IsNotEmpty()
  addressDetail: string;

  @ApiProperty({ example: true, description: 'Set as primary address', default: false })
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}
