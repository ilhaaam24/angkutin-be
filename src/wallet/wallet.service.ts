import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
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

  // --- WITHDRAWAL FLOW ---

  getSupportedChannels() {
    return this.xenditService.getSupportedChannels();
  }

  /**
   * 1. REQUEST WITHDRAWAL (User/Courier)
   * Status: PENDING (Waiting for Admin)
   */
  async requestWithdrawal(userId: string, withdrawDto: WithdrawDto): Promise<Withdrawal> {
    const wallet = await this.getWallet(userId);
    let { amount, method, accountNumber, accountName, paymentAccountId } = withdrawDto;

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
      throw new BadRequestException('Payment details are required');
    }

    const channel = this.xenditService.resolveChannelCode(method);
    if (!channel) {
      throw new BadRequestException(`Metode "${method}" tidak didukung.`);
    }

    if (!accountName) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      accountName = user?.name || 'Angkutin User';
    }

    if (wallet.balance < amount) {
      throw new BadRequestException('Saldo tidak cukup untuk penarikan');
    }

    return this.prisma.$transaction(async (tx) => {
      // Create Withdrawal Record (PENDING Approval)
      const w = await tx.withdrawal.create({
        data: {
          userId,
          amount,
          method: channel.code,
          accountNumber,
          accountName,
          status: WithdrawalStatus.PENDING,
        },
      });

      // Create Wallet Transaction (DEBIT - PENDING)
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEBIT,
          amount,
          referenceType: WalletReferenceType.WITHDRAWAL,
          referenceId: w.id,
          status: TransactionStatus.PENDING,
          description: `Penarikan ke ${method} (${accountNumber}) - Menunggu Persetujuan`,
        },
      });

      // Deduct Wallet Balance (Hold)
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      });

      return w;
    });
  }

  /**
   * 2. APPROVE WITHDRAWAL (Admin)
   * Status: PENDING -> PROCESSING (Sent to Xendit)
   */
  async approveWithdrawal(withdrawalId: string): Promise<Withdrawal> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(`Cannot approve withdrawal with status ${withdrawal.status}`);
    }

    try {
      // Call Xendit API
      const xenditPayout = await this.xenditService.createPayout({
        referenceId: withdrawal.id,
        channelCode: withdrawal.method,
        accountNumber: withdrawal.accountNumber,
        accountHolderName: withdrawal.accountName,
        amount: withdrawal.amount,
        description: `Angkutin withdrawal - ${withdrawal.id}`,
      });

      // Update status to PROCESSING
      return this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          externalId: xenditPayout.id,
          status: WithdrawalStatus.PROCESSING,
        },
      });
    } catch (error) {
      console.error('[ADMIN APPROVE] Xendit payout failed:', error.message);
      throw new BadRequestException(`Gagal mengirim ke Xendit: ${error.message}`);
    }
  }

  /**
   * 3. REJECT WITHDRAWAL (Admin)
   * Status: PENDING -> FAILED (Refund Balance)
   */
  async rejectWithdrawal(withdrawalId: string, reason: string): Promise<Withdrawal> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(`Cannot reject withdrawal with status ${withdrawal.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Refund Balance
      const wallet = await tx.wallet.findUnique({
        where: { userId: withdrawal.userId },
      });

      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: withdrawal.amount } },
        });
      }

      // 2. Mark Transaction as FAILED
      await tx.walletTransaction.updateMany({
        where: {
          referenceId: withdrawal.id,
          referenceType: WalletReferenceType.WITHDRAWAL,
        },
        data: {
          status: TransactionStatus.FAILED,
          description: `Penarikan Ditolak: ${reason}`,
        },
      });

      // 3. Mark Withdrawal as FAILED
      return tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.FAILED,
          failureReason: `Ditolak Admin: ${reason}`,
          processedAt: new Date(),
        },
      });
    });
  }

  async getAllWithdrawals() {
    return this.prisma.withdrawal.findMany({
      include: { user: { select: { name: true, email: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- XENDIT WEBHOOK HANDLER ---

  async handleXenditPayoutWebhook(payload: any) {
    const data = payload.data || payload;
    const { reference_id, status, failure_code } = data;

    if (!reference_id) {
      console.warn('[WEBHOOK] Missing reference_id in payload data:', JSON.stringify(payload));
      return { received: true };
    }

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: reference_id },
    });

    if (!withdrawal) return { received: true };
    if (withdrawal.status === WithdrawalStatus.SUCCESS || withdrawal.status === WithdrawalStatus.FAILED) {
      return { received: true };
    }

    if (status === 'SUCCEEDED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.withdrawal.update({
          where: { id: reference_id },
          data: { status: WithdrawalStatus.SUCCESS, processedAt: new Date() },
        });

        await tx.walletTransaction.updateMany({
          where: { referenceId: reference_id, referenceType: WalletReferenceType.WITHDRAWAL },
          data: { status: TransactionStatus.SUCCESS },
        });
      });
    } else if (status === 'FAILED') {
      await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId: withdrawal.userId },
        });

        if (wallet) {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: withdrawal.amount } },
          });
        }

        await tx.withdrawal.update({
          where: { id: reference_id },
          data: {
            status: WithdrawalStatus.FAILED,
            failureReason: failure_code || 'Payout failed',
            processedAt: new Date(),
          },
        });

        await tx.walletTransaction.updateMany({
          where: { referenceId: reference_id, referenceType: WalletReferenceType.WITHDRAWAL },
          data: { status: TransactionStatus.FAILED },
        });
      });
    }

    return { received: true };
  }
}
