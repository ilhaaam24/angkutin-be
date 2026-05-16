import { Controller, Post, Body, Headers, BadRequestException, Logger } from '@nestjs/common';
import { XenditService } from '../xendit/xendit.service';
import { OrdersService } from '../orders/orders.service';

@Controller('webhooks/xendit')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly xenditService: XenditService,
    private readonly ordersService: OrdersService,
  ) {}

  @Post('invoice')
  async handleInvoiceCallback(
    @Headers('x-callback-token') callbackToken: string,
    @Body() body: any,
  ) {
    this.logger.log(`[XENDIT CALLBACK] Received invoice callback for external_id: ${body.external_id}`);

    // 1. Verify token
    if (!this.xenditService.verifyWebhookToken(callbackToken)) {
      this.logger.error('[XENDIT CALLBACK] Invalid callback token');
      throw new BadRequestException('Invalid callback token');
    }

    // 2. Process based on status
    const { external_id, status } = body;

    if (status === 'PAID') {
      await this.ordersService.handlePaymentSuccess(external_id);
    } else if (status === 'EXPIRED') {
      await this.ordersService.handlePaymentExpired(external_id);
    }

    return { status: 'OK' };
  }
}
