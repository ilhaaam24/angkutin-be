import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateWasteTypeDto {
  @ApiProperty({ example: 'Plastic', description: 'Name of the waste type' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 5000, description: 'Price per unit (kg/item)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  unitPrice: number;
}
