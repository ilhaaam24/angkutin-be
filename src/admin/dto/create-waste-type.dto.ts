import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { WasteCategory } from '../../generated/prisma';

export class AdminCreateWasteTypeDto {
  @ApiProperty({ example: 'Plastik PET', description: 'Nama jenis sampah' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: WasteCategory, example: 'MUTU', description: 'Kategori: MUTU (bernilai) atau RESIDU (biaya)' })
  @IsEnum(WasteCategory)
  @IsNotEmpty()
  category: WasteCategory;

  @ApiProperty({ example: 5000, description: 'Harga per kg' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  unitPrice: number;
}
