import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CouriersModule } from '../couriers/couriers.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [CouriersModule, WalletModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
