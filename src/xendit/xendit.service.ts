import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Xendit } from 'xendit-node';
import * as crypto from 'crypto';

@Injectable()
export class XenditService {
  private xenditClient: Xendit;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('XENDIT_SECRET_API_KEY');
    if (!secretKey) {
      console.error('[XENDIT] XENDIT_SECRET_API_KEY is not configured!');
    }
    // Tambahkan .trim() untuk membersihkan spasi yang tidak sengaja terbawa
    this.xenditClient = new Xendit({ secretKey: secretKey?.trim() || '' });
  }

  /**
   * Channel code mapping for common Indonesian banks and e-wallets.
   * Use GET /payouts_channels from Xendit for the full list.
   */
  private static readonly CHANNEL_MAP: Record<string, { code: string; category: 'BANK' | 'EWALLET' }> = {
    // Banks
    BCA: { code: 'ID_BCA', category: 'BANK' },
    BNI: { code: 'ID_BNI', category: 'BANK' },
    BRI: { code: 'ID_BRI', category: 'BANK' },
    MANDIRI: { code: 'ID_MANDIRI', category: 'BANK' },
    BSI: { code: 'ID_BSI', category: 'BANK' },
    PERMATA: { code: 'ID_PERMATA', category: 'BANK' },
    CIMB: { code: 'ID_CIMB', category: 'BANK' },
    DANAMON: { code: 'ID_DANAMON', category: 'BANK' },
    BCA_SYARIAH: { code: 'ID_BCA_SYR', category: 'BANK' },
    // E-Wallets
    OVO: { code: 'ID_OVO', category: 'EWALLET' },
    DANA: { code: 'ID_DANA', category: 'EWALLET' },
    LINKAJA: { code: 'ID_LINKAJA', category: 'EWALLET' },
    SHOPEEPAY: { code: 'ID_SHOPEEPAY', category: 'EWALLET' },
    GOPAY: { code: 'ID_GOPAY', category: 'EWALLET' },
  };

  /**
   * Resolve a user-friendly provider name to a Xendit channel code.
   */
  resolveChannelCode(providerName: string): { code: string; category: 'BANK' | 'EWALLET' } | null {
    const key = providerName.toUpperCase().replace(/\s+/g, '_');
    return XenditService.CHANNEL_MAP[key] || null;
  }

  /**
   * Get all supported payout channels.
   */
  getSupportedChannels() {
    return Object.entries(XenditService.CHANNEL_MAP).map(([name, info]) => ({
      name,
      channelCode: info.code,
      category: info.category,
    }));
  }

  /**
   * Create a Xendit Payout (Disbursement v2).
   * Returns the payout object from Xendit with status ACCEPTED.
   */
  async createPayout(params: {
    referenceId: string;
    channelCode: string;
    accountNumber: string;
    accountHolderName: string;
    amount: number;
    description: string;
  }) {
    try {
      const idempotencyKey = `withdrawal-${params.referenceId}`;

      // Check if it's an E-Wallet to adjust channelProperties
      const channelInfo = Object.values(XenditService.CHANNEL_MAP).find(
        (c) => c.code === params.channelCode,
      );
      const isEWallet = channelInfo?.category === 'EWALLET';

      // Clean account number (remove spaces/dashes)
      const sanitizedAccountNumber = params.accountNumber.replace(/[^0-9]/g, '');

      const payoutData: any = {
        referenceId: params.referenceId,
        channelCode: params.channelCode,
        channelProperties: {
          accountNumber: sanitizedAccountNumber,
        },
        amount: Math.floor(params.amount), // Ensure integer for IDR
        currency: 'IDR',
        description: params.description,
      };

      // Xendit Payouts V2: accountHolderName is usually only for BANK channels
      // Providing it for EWALLET might cause a 400 Bad Request
      if (!isEWallet && params.accountHolderName) {
        payoutData.channelProperties.accountHolderName = params.accountHolderName;
      }

      console.log(`[XENDIT] Attempting payout: ${params.referenceId} to ${params.channelCode}`);

      const response = await this.xenditClient.Payout.createPayout({
        idempotencyKey,
        data: payoutData,
      });

      console.log(`[XENDIT] Payout created: ${response.id}, status: ${response.status}`);
      return response;
    } catch (error: any) {
      // Improved error logging to see the exact reason from Xendit
      const errorDetails = error.response?.data || error.fullError || error;
      console.error('[XENDIT] Payout creation failed. Details:', JSON.stringify(errorDetails, null, 2));
      
      throw new InternalServerErrorException(
        `Xendit disbursement failed: ${error?.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * Verify the Xendit webhook callback token.
   * Xendit sends a x-callback-token header that must match
   * the Callback Verification Token from dashboard settings.
   */
  verifyWebhookToken(callbackToken: string): boolean {
    const expectedToken = this.configService.get<string>('XENDIT_WEBHOOK_TOKEN');
    if (!expectedToken) {
      console.warn('[XENDIT] XENDIT_WEBHOOK_TOKEN not configured, skipping verification');
      return true; // Allow in development
    }
    return crypto.timingSafeEqual(
      Buffer.from(callbackToken),
      Buffer.from(expectedToken),
    );
  }
}
