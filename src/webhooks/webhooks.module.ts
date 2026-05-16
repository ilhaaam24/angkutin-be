import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { XenditModule } from '../xendit/xendit.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [XenditModule, OrdersModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
