import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty, Min, IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';

export enum WithdrawalChannelType {
  BANK = 'BANK',
  EWALLET = 'EWALLET',
}

export class TopUpDto {
  @ApiProperty({ example: 50000, description: 'Amount to top up' })
  @IsNumber()
  @IsNotEmpty()
  @Min(10000)
  amount: number;

  @ApiProperty({ example: 'OVO', description: 'Payment method' })
  @IsString()
  @IsNotEmpty()
  method: string;
}

export class CreateTransactionDto {
  @IsNumber()
  amount: number;

  @IsString()
  type: 'CREDIT' | 'DEBIT';

  @IsString()
  referenceType: string;

  @IsString()
  @IsOptional()
  referenceId?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class WithdrawDto {
  @ApiProperty({ example: 50000, description: 'Amount to withdraw (min Rp 10.000)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(10000)
  amount: number;

  @ApiProperty({
    example: 'BCA',
    description: 'Bank or E-Wallet provider name (e.g. BCA, BNI, BRI, MANDIRI, OVO, DANA, GOPAY, SHOPEEPAY)',
  })
  @IsString()
  @IsNotEmpty()
  method: string;

  @ApiProperty({ example: '1234567890', description: 'Bank account number or E-Wallet phone number' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiProperty({ example: 'John Doe', description: 'Account holder name' })
  @IsString()
  @IsOptional()
  accountName?: string;

  @ApiProperty({ example: 'uuid-payment-account-id', required: false, description: 'Use saved payment account instead of manual input' })
  @IsString()
  @IsOptional()
  paymentAccountId?: string;
}

export class CreatePaymentAccountDto {
  @ApiProperty({ example: 'BCA', description: 'Bank or E-Wallet provider name' })
  @IsString()
  @IsNotEmpty()
  providerName: string;

  @ApiProperty({ example: '1234567890', description: 'Account number' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiProperty({ example: 'John Doe', description: 'Account holder name' })
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  isDefault?: boolean;
}

export class UpdatePaymentAccountDto extends PartialType(CreatePaymentAccountDto) {}
