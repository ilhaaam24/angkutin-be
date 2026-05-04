import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Wallet, WalletTransaction, WalletTransactionType, WalletReferenceType, TransactionStatus, Withdrawal } from '../generated/prisma';
import { TopUpDto, WithdrawDto, CreatePaymentAccountDto } from './dto/wallet.dto';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

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

  async removePaymentAccount(userId: string, id: string) {
    const account = await this.prisma.userPaymentAccount.findFirst({
      where: { id, userId },
    });

    if (!account) throw new NotFoundException('Payment account not found');

    return this.prisma.userPaymentAccount.delete({
      where: { id },
    });
  }

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

    if (!method || !accountNumber || !accountName) {
      throw new BadRequestException('Payment details are required (either manual or via saved account)');
    }

    if (wallet.balance < amount) {
      throw new BadRequestException('Insufficient balance for withdrawal');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Withdrawal Record
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amount,
          method,
          accountNumber,
          accountName,
        },
      });

      // 2. Create Wallet Transaction (DEBIT)
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEBIT,
          amount,
          referenceType: WalletReferenceType.WITHDRAWAL,
          referenceId: withdrawal.id,
          status: TransactionStatus.SUCCESS,
          description: `Withdrawal to ${method} (${accountNumber})`,
        },
      });

      // 3. Deduct Wallet Balance
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: amount },
        },
      });

      return withdrawal;
    });
  }
}
