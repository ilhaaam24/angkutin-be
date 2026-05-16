import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';

export enum PaymentMethod {
  WALLET = 'WALLET',
  QRIS = 'QRIS',
  E_WALLET = 'E_WALLET',
}

export class PayOrderDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.WALLET })
  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  method: PaymentMethod;
}
