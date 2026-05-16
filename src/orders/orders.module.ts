import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { WalletModule } from '../wallet/wallet.module';
import { XenditModule } from '../xendit/xendit.module';

@Module({
  imports: [WalletModule, XenditModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
