import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class WeighingItemDto {
  @ApiProperty({ example: 'uuid-waste-type-id', description: 'ID dari jenis sampah' })
  @IsUUID()
  @IsNotEmpty()
  wasteTypeId: string;

  @ApiProperty({ example: 2.5, description: 'Berat hasil timbangan (kg)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  weight: number;
}

export class SubmitWeighingDto {
  @ApiProperty({ 
    type: WeighingItemDto, 
    description: 'Data sampah kategori MUTU (Pilih satu jenis)', 
    required: false 
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeighingItemDto)
  mutuItem?: WeighingItemDto;

  @ApiProperty({ 
    example: 2.5, 
    description: 'Total berat sampah RESIDU (Tanpa pilih jenis)', 
    required: false 
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  residualWeight?: number;
}
