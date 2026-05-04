import { Controller, Get, Post, Body, UseGuards, Request, Param, Delete } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { TopUpDto, WithdrawDto, CreatePaymentAccountDto } from './dto/wallet.dto';

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get current wallet balance' })
  @ApiResponse({ status: 200, description: 'Return wallet data.' })
  async getBalance(@Request() req) {
    return this.walletService.getWallet(req.user.userId);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get wallet transaction history' })
  @ApiResponse({ status: 200, description: 'Return transaction list.' })
  async getTransactions(@Request() req) {
    return this.walletService.getTransactions(req.user.userId);
  }

  @Post('topup')
  @ApiOperation({ summary: 'Mock top up wallet balance' })
  @ApiResponse({ status: 201, description: 'Balance successfully topped up.' })
  async topUp(@Request() req, @Body() topUpDto: TopUpDto) {
    return this.walletService.topUp(req.user.userId, topUpDto);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Request a withdrawal' })
  @ApiResponse({ status: 201, description: 'Withdrawal successfully requested.' })
  async withdraw(@Request() req, @Body() withdrawDto: WithdrawDto) {
    return this.walletService.requestWithdrawal(req.user.userId, withdrawDto);
  }

  // --- SAVED ACCOUNTS ---

  @Get('accounts')
  @ApiOperation({ summary: 'Get list of saved payment accounts' })
  async getAccounts(@Request() req) {
    return this.walletService.listPaymentAccounts(req.user.userId);
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Save a new payment account' })
  async createAccount(@Request() req, @Body() data: CreatePaymentAccountDto) {
    return this.walletService.createPaymentAccount(req.user.userId, data);
  }

  @Delete('accounts/:id')
  @ApiOperation({ summary: 'Remove a saved payment account' })
  async removeAccount(@Request() req, @Param('id') id: string) {
    return this.walletService.removePaymentAccount(req.user.userId, id);
  }
}
