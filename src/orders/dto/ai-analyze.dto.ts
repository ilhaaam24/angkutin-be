import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AiAnalyzeDto {
  @ApiProperty({ example: 'https://storage.angkutin.com/temp/waste-photo.jpg', required: false })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({ example: 'Plastik, Kertas', required: false })
  @IsString()
  @IsOptional()
  manualHint?: string;
}
