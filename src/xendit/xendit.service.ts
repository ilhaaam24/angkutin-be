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
    this.xenditClient = new Xendit({ secretKey: secretKey || '' });
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

      const response = await this.xenditClient.Payout.createPayout({
        idempotencyKey,
        data: {
          referenceId: params.referenceId,
          channelCode: params.channelCode,
          channelProperties: {
            accountNumber: params.accountNumber,
            accountHolderName: params.accountHolderName,
          },
          amount: params.amount,
          currency: 'IDR',
          description: params.description,
        },
      });

      console.log(`[XENDIT] Payout created: ${response.id}, status: ${response.status}`);
      return response;
    } catch (error: any) {
      console.error('[XENDIT] Payout creation failed:', error?.message || error);
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
