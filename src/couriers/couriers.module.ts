import { Module } from '@nestjs/common';
import { CouriersController } from './couriers.controller';
import { CouriersService } from './couriers.service';
import { OrdersModule } from '../orders/orders.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [OrdersModule, UploadModule],
  controllers: [CouriersController],
  providers: [CouriersService],
  exports: [CouriersService],
})
export class CouriersModule {}
