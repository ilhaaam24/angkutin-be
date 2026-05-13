import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Wallet,
  WalletTransaction,
  WalletTransactionType,
  WalletReferenceType,
  TransactionStatus,
  Withdrawal,
  WithdrawalStatus,
} from '../generated/prisma';
import { TopUpDto, WithdrawDto, CreatePaymentAccountDto, UpdatePaymentAccountDto } from './dto/wallet.dto';
import { XenditService } from '../xendit/xendit.service';

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private xenditService: XenditService,
  ) {}

  async getWallet(userId: string): Promise<Wallet> {
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      // Auto-create wallet if not exists (safety fallback)
      wallet = await this.prisma.wallet.create({
        data: { userId, balance: 0 },
      });
    }

    return wallet;
  }

  async getTransactions(userId: string): Promise<WalletTransaction[]> {
    const wallet = await this.getWallet(userId);
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async topUp(userId: string, topUpDto: TopUpDto): Promise<WalletTransaction> {
    const wallet = await this.getWallet(userId);
    const { amount, method } = topUpDto;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Transaction record
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.CREDIT,
          amount,
          referenceType: WalletReferenceType.PAYMENT,
          status: TransactionStatus.SUCCESS, // Mock: Auto-success for now
          description: `Top up via ${method}`,
        },
      });

      // 2. Update Wallet balance
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: amount },
        },
      });

      return transaction;
    });
  }

  async processOrderPayment(userId: string, orderId: string, amount: number, description: string): Promise<WalletTransaction> {
    const wallet = await this.getWallet(userId);

    if (wallet.balance < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEBIT,
          amount,
          referenceType: WalletReferenceType.ORDER,
          referenceId: orderId,
          status: TransactionStatus.SUCCESS,
          description,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: amount },
        },
      });

      return transaction;
    });
  }

  // Credit courier for completed order
  async creditCourierOrder(userId: string, orderId: string, amount: number, description: string): Promise<WalletTransaction> {
    const wallet = await this.getWallet(userId);

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.CREDIT,
          amount,
          referenceType: WalletReferenceType.ORDER,
          referenceId: orderId,
          status: TransactionStatus.SUCCESS,
          description,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: amount },
        },
      });

      return transaction;
    });
  }

  // --- PAYMENT ACCOUNTS ---

  async listPaymentAccounts(userId: string) {
    return this.prisma.userPaymentAccount.findMany({
      where: { userId },
      orderBy: { isDefault: 'desc' },
    });
  }

  async createPaymentAccount(userId: string, data: CreatePaymentAccountDto) {
    if (data.isDefault) {
      // Unset previous default
      await this.prisma.userPaymentAccount.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.userPaymentAccount.create({
      data: {
        ...data,
        userId,
      },
    });
  }

  async updatePaymentAccount(userId: string, id: string, data: UpdatePaymentAccountDto) {
    const account = await this.prisma.userPaymentAccount.findFirst({
      where: { id, userId },
    });

    if (!account) throw new NotFoundException('Payment account not found');

    if (data.isDefault) {
      // Unset previous default
      await this.prisma.userPaymentAccount.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.userPaymentAccount.update({
      where: { id },
      data,
    });
  }

  async removePaymentAccount(userId: string, id: string) {
    const account = await this.prisma.userPaymentAccount.findFirst({
      where: { id, userId },
    });

    if (!account) throw new NotFoundException('Payment account not found');

    return this.prisma.userPaymentAccount.delete({
      where: { id },
    });
  }

  // --- WITHDRAWAL WITH XENDIT ---

  /**
   * Get list of supported withdrawal channels (bank & e-wallet).
   */
  getSupportedChannels() {
    return this.xenditService.getSupportedChannels();
  }

  /**
   * Request withdrawal via Xendit Payout API.
   * Flow:
   * 1. Validate balance & resolve payment details
   * 2. Resolve Xendit channel code from provider name
   * 3. Deduct balance immediately (hold)
   * 4. Create Xendit payout (async - status ACCEPTED)
   * 5. Store externalId for webhook tracking
   * 6. Webhook will confirm or revert later
   */
  async requestWithdrawal(userId: string, withdrawDto: WithdrawDto): Promise<Withdrawal> {
    const wallet = await this.getWallet(userId);
    let { amount, method, accountNumber, accountName, paymentAccountId } = withdrawDto;

    // Jika menggunakan ID rekening tersimpan
    if (paymentAccountId) {
      const savedAccount = await this.prisma.userPaymentAccount.findFirst({
        where: { id: paymentAccountId, userId },
      });
      if (!savedAccount) throw new NotFoundException('Saved payment account not found');

      method = savedAccount.providerName;
      accountNumber = savedAccount.accountNumber;
      accountName = savedAccount.accountName;
    }

    if (!method || !accountNumber) {
      throw new BadRequestException('Payment details are required (either manual or via saved account)');
    }

    // Resolve Xendit channel code
    const channel = this.xenditService.resolveChannelCode(method);
    if (!channel) {
      throw new BadRequestException(
        `Metode "${method}" tidak didukung. Gunakan: BCA, BNI, BRI, MANDIRI, OVO, DANA, GOPAY, SHOPEEPAY, dll.`,
      );
    }

    // Default account name
    if (!accountName) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      accountName = user?.name || 'Angkutin User';
    }

    // Validate balance
    if (wallet.balance < amount) {
      throw new BadRequestException('Saldo tidak cukup untuk penarikan');
    }

    // Execute in transaction: create withdrawal record + deduct balance
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      // 1. Create Withdrawal Record (PENDING → will be PROCESSING after Xendit call)
      const w = await tx.withdrawal.create({
        data: {
          userId,
          amount,
          method: channel.code, // Store Xendit channel code
          accountNumber,
          accountName,
          status: WithdrawalStatus.PENDING,
        },
      });

      // 2. Create Wallet Transaction (DEBIT - PENDING until Xendit confirms)
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEBIT,
          amount,
          referenceType: WalletReferenceType.WITHDRAWAL,
          referenceId: w.id,
          status: TransactionStatus.PENDING,
          description: `Penarikan ke ${method} (${accountNumber})`,
        },
      });

      // 3. Deduct Wallet Balance (hold)
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: amount },
        },
      });

      return w;
    });

    // 4. Call Xendit Payout API (outside transaction - async)
    try {
      const xenditPayout = await this.xenditService.createPayout({
        referenceId: withdrawal.id,
        channelCode: channel.code,
        accountNumber,
        accountHolderName: accountName,
        amount,
        description: `Angkutin withdrawal - ${withdrawal.id}`,
      });

      // 5. Update withdrawal with Xendit external ID
      await this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          externalId: xenditPayout.id,
          status: WithdrawalStatus.PROCESSING,
        },
      });

      return {
        ...withdrawal,
        externalId: xenditPayout.id,
        status: WithdrawalStatus.PROCESSING,
      };
    } catch (error) {
      // Xendit call failed → revert the balance deduction
      console.error('[WITHDRAWAL] Xendit payout failed, reverting balance:', error.message);

      await this.prisma.$transaction(async (tx) => {
        // Revert wallet balance
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: amount } },
        });

        // Mark withdrawal as FAILED
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: WithdrawalStatus.FAILED,
            failureReason: error.message || 'Xendit payout creation failed',
          },
        });

        // Mark wallet transaction as FAILED
        await tx.walletTransaction.updateMany({
          where: {
            referenceId: withdrawal.id,
            referenceType: WalletReferenceType.WITHDRAWAL,
          },
          data: { status: TransactionStatus.FAILED },
        });
      });

      throw new BadRequestException(
        'Penarikan gagal diproses. Saldo Anda telah dikembalikan. Silakan coba lagi.',
      );
    }
  }

  // --- XENDIT WEBHOOK HANDLER ---

  /**
   * Handle Xendit payout webhook callback.
   * Called when payout status changes (SUCCEEDED / FAILED).
   */
  async handleXenditPayoutWebhook(payload: any) {
    // Xendit Payout v2 membungkus data utama di dalam objek 'data'
    const data = payload.data || payload;
    const { reference_id, status, failure_code } = data;

    if (!reference_id) {
      console.warn('[WEBHOOK] Missing reference_id in payload data:', JSON.stringify(payload));
      return { received: true };
    }

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: reference_id },
    });

    if (!withdrawal) {
      console.warn(`[WEBHOOK] Withdrawal not found for reference_id: ${reference_id}`);
      return { received: true };
    }

    // Skip if already in terminal state
    if (withdrawal.status === WithdrawalStatus.SUCCESS || withdrawal.status === WithdrawalStatus.FAILED) {
      console.log(`[WEBHOOK] Withdrawal ${reference_id} already in terminal state: ${withdrawal.status}`);
      return { received: true };
    }

    if (status === 'SUCCEEDED') {
      await this.prisma.$transaction(async (tx) => {
        // Mark withdrawal as SUCCESS
        await tx.withdrawal.update({
          where: { id: reference_id },
          data: {
            status: WithdrawalStatus.SUCCESS,
            processedAt: new Date(),
          },
        });

        // Mark wallet transaction as SUCCESS
        await tx.walletTransaction.updateMany({
          where: {
            referenceId: reference_id,
            referenceType: WalletReferenceType.WITHDRAWAL,
          },
          data: { status: TransactionStatus.SUCCESS },
        });
      });

      console.log(`[WEBHOOK] Withdrawal ${reference_id} SUCCEEDED`);
    } else if (status === 'FAILED') {
      // Refund balance
      await this.prisma.$transaction(async (tx) => {
        // Refund wallet balance
        const wallet = await tx.wallet.findUnique({
          where: { userId: withdrawal.userId },
        });

        if (wallet) {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: withdrawal.amount } },
          });
        }

        // Mark withdrawal as FAILED
        await tx.withdrawal.update({
          where: { id: reference_id },
          data: {
            status: WithdrawalStatus.FAILED,
            failureReason: failure_code || 'Payout failed',
            processedAt: new Date(),
          },
        });

        // Mark wallet transaction as FAILED
        await tx.walletTransaction.updateMany({
          where: {
            referenceId: reference_id,
            referenceType: WalletReferenceType.WITHDRAWAL,
          },
          data: { status: TransactionStatus.FAILED },
        });
      });

      console.log(`[WEBHOOK] Withdrawal ${reference_id} FAILED: ${failure_code}`);
    }

    return { received: true };
  }
}
