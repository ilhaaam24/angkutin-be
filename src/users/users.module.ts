import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AddressesModule } from '../addresses/addresses.module';
import { UsersController } from './users.controller';

@Module({
  imports: [PrismaModule, AddressesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}