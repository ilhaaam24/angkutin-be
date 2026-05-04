import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { AddressesModule } from './addresses/addresses.module';
import { CouriersModule } from './couriers/couriers.module';
import { WasteTypesModule } from './waste-types/waste-types.module';
import { OrdersModule } from './orders/orders.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AddressesModule,
    CouriersModule,
    WasteTypesModule,
    OrdersModule,
    WalletModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
