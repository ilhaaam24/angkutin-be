import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AiAnalyzeDto {
  @ApiProperty({ 
    example: 'https://storage.angkutin.com/temp/waste-photo.jpg', 
    required: false,
    description: 'URL foto sampah yang akan dianalisis (opsional jika manualHint diberikan)'
  })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({ 
    example: 'Kardus bekas banyak sekali, ada plastik sedikit', 
    required: false,
    description: 'Hint manual dari user untuk membantu akurasi AI'
  })
  @IsString()
  @IsOptional()
  manualHint?: string;
}
