import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested, IsUUID, IsNumber, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ScheduleType } from '../../generated/prisma';

export class CreateOrderDto {
  @ApiProperty({ 
    example: '550e8400-e29b-41d4-a716-446655440000', 
    description: 'ID alamat yang dipilih dari /addresses' 
  })
  @IsUUID()
  @IsNotEmpty()
  addressId: string;

  @ApiProperty({ 
    enum: ['INSTANT', 'SCHEDULED'], 
    example: 'INSTANT',
    description: 'Tipe penjemputan: Langsung (INSTANT) atau Terjadwal (SCHEDULED)'
  })
  @IsEnum(['INSTANT', 'SCHEDULED'])
  @IsNotEmpty()
  scheduleType: ScheduleType;

  @ApiProperty({ 
    example: '2026-05-20T10:00:00Z', 
    required: false,
    description: 'Waktu penjemputan jika tipe SCHEDULED (ISO String). Jika INSTANT, field ini diabaikan.'
  })
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @ApiProperty({ 
    example: 'Tolong ambil di depan pagar warna hitam', 
    required: false,
    description: 'Catatan tambahan untuk kurir'
  })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ 
    example: '550e8400-e29b-41d4-a716-446655440000', 
    required: false, 
    description: 'ID hasil scan AI jika sebelumnya menggunakan /orders/ai-analyze' 
  })
  @IsUUID()
  @IsOptional()
  aiResultId?: string;
}
