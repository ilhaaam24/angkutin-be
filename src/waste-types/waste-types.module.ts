import { Module } from '@nestjs/common';
import { WasteTypesService } from './waste-types.service';
import { WasteTypesController } from './waste-types.controller';

@Module({
  providers: [WasteTypesService],
  controllers: [WasteTypesController]
})
export class WasteTypesModule {}
