import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Nomor rekening tidak valid', description: 'Alasan penolakan' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
