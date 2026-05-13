import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WasteType } from '../generated/prisma';
import { CreateWasteTypeDto } from './dto/create-waste-type.dto';
import { UpdateWasteTypeDto } from './dto/update-waste-type.dto';

@Injectable()
export class WasteTypesService {
  constructor(private prisma: PrismaService) {}

  async create(createWasteTypeDto: CreateWasteTypeDto): Promise<WasteType> {
    return this.prisma.wasteType.create({
      data: createWasteTypeDto,
    });
  }

  async findAll(): Promise<{ lastUpdate: Date | null; data: WasteType[] }> {
    const wasteTypes = await this.prisma.wasteType.findMany({
      orderBy: { name: 'asc' },
    });

    const lastUpdate = wasteTypes.reduce((max, curr) => {
      return !max || curr.updatedAt > max ? curr.updatedAt : max;
    }, null as Date | null);

    return {
      lastUpdate,
      data: wasteTypes,
    };
  }

  async findOne(id: string): Promise<WasteType> {
    const wasteType = await this.prisma.wasteType.findUnique({
      where: { id },
    });
    if (!wasteType) {
      throw new NotFoundException(`Waste type with ID ${id} not found`);
    }
    return wasteType;
  }

  async update(id: string, updateWasteTypeDto: UpdateWasteTypeDto): Promise<WasteType> {
    try {
      return await this.prisma.wasteType.update({
        where: { id },
        data: updateWasteTypeDto,
      });
    } catch (error) {
      throw new NotFoundException(`Waste type with ID ${id} not found`);
    }
  }

  async remove(id: string): Promise<WasteType> {
    try {
      return await this.prisma.wasteType.delete({
        where: { id },
      });
    } catch (error) {
      throw new NotFoundException(`Waste type with ID ${id} not found`);
    }
  }
}
