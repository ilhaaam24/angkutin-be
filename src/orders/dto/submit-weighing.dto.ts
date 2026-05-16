import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class SubmitWeighingDto {
  @ApiProperty({ 
    example: 'uuid-waste-type-id', 
    description: 'ID jenis sampah MUTU yang dipilih kurir (pilih satu)' 
  })
  @IsUUID()
  @IsNotEmpty()
  wasteTypeId: string;
}
