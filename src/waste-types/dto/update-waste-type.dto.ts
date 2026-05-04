import { PartialType } from '@nestjs/swagger';
import { CreateWasteTypeDto } from './create-waste-type.dto';

export class UpdateWasteTypeDto extends PartialType(CreateWasteTypeDto) {}
