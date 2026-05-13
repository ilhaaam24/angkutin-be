import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  Request,
  Param,
  Delete,
  Headers,
  UnauthorizedException,
  HttpCode,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { XenditService } from '../xendit/xendit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { TopUpDto, WithdrawDto, CreatePaymentAccountDto, UpdatePaymentAccountDto } from './dto/wallet.dto';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly xenditService: XenditService,
  ) {}

  // --- WALLET BALANCE & TRANSACTIONS ---

  @Get('balance')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current wallet balance' })
  @ApiResponse({ status: 200, description: 'Return wallet data.' })
  async getBalance(@Request() req) {
    return this.walletService.getWallet(req.user.userId);
  }

  @Get('transactions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get wallet transaction history' })
  @ApiResponse({ status: 200, description: 'Return transaction list.' })
  async getTransactions(@Request() req) {
    return this.walletService.getTransactions(req.user.userId);
  }

  @Post('topup')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Mock top up wallet balance' })
  @ApiResponse({ status: 201, description: 'Balance successfully topped up.' })
  async topUp(@Request() req, @Body() topUpDto: TopUpDto) {
    return this.walletService.topUp(req.user.userId, topUpDto);
  }

  // --- WITHDRAWAL (XENDIT) ---

  @Get('channels')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get supported withdrawal channels (Bank & E-Wallet)' })
  @ApiResponse({ status: 200, description: 'Return list of supported channels.' })
  async getSupportedChannels() {
    return this.walletService.getSupportedChannels();
  }

  @Post('withdraw')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Request withdrawal to bank or e-wallet via Xendit' })
  @ApiResponse({ status: 201, description: 'Withdrawal request submitted to Xendit.' })
  @ApiResponse({ status: 400, description: 'Invalid method, insufficient balance, or Xendit error.' })
  async withdraw(@Request() req, @Body() withdrawDto: WithdrawDto) {
    return this.walletService.requestWithdrawal(req.user.userId, withdrawDto);
  }

  // --- SAVED ACCOUNTS ---

  @Get('accounts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get list of saved payment accounts' })
  async getAccounts(@Request() req) {
    return this.walletService.listPaymentAccounts(req.user.userId);
  }

  @Post('accounts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Save a new payment account' })
  async createAccount(@Request() req, @Body() data: CreatePaymentAccountDto) {
    return this.walletService.createPaymentAccount(req.user.userId, data);
  }

  @Patch('accounts/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update a saved payment account' })
  async updateAccount(@Request() req, @Param('id') id: string, @Body() data: UpdatePaymentAccountDto) {
    return this.walletService.updatePaymentAccount(req.user.userId, id, data);
  }

  @Delete('accounts/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Remove a saved payment account' })
  async removeAccount(@Request() req, @Param('id') id: string) {
    return this.walletService.removePaymentAccount(req.user.userId, id);
  }

  // --- XENDIT WEBHOOK (No Auth Guard - called by Xendit servers) ---

  @Post('webhook/xendit/payout')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async handleXenditWebhook(
    @Headers('x-callback-token') callbackToken: string,
    @Body() payload: any,
  ) {
    // Verify webhook authenticity
    if (!callbackToken || !this.xenditService.verifyWebhookToken(callbackToken)) {
      console.warn('[WEBHOOK] Invalid callback token received');
      throw new UnauthorizedException('Invalid callback token');
    }

    console.log('[WEBHOOK] Xendit payout event received:', JSON.stringify(payload));
    return this.walletService.handleXenditPayoutWebhook(payload);
  }
}
