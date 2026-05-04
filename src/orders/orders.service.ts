import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order, OrderStatus } from '../generated/prisma';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, createOrderDto: CreateOrderDto): Promise<Order> {
    const { addressId, wasteItems, scheduleType, scheduledAt, note } = createOrderDto;

    // 1. Verify address belongs to user
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found or does not belong to user');
    }

    // 2. Process waste items and calculate prices
    const wasteTypeIds = wasteItems.map((item) => item.wasteTypeId);
    const wasteTypes = await this.prisma.wasteType.findMany({
      where: { id: { in: wasteTypeIds } },
    });

    if (wasteTypes.length !== wasteItems.length) {
      throw new BadRequestException('One or more waste types are invalid');
    }

    let totalCredit = 0;
    const processedWasteItems = wasteItems.map((item) => {
      const wasteType = wasteTypes.find((wt) => wt.id === item.wasteTypeId);
      const subtotal = item.weight * wasteType!.unitPrice;
      totalCredit += subtotal;
      return {
        wasteTypeId: item.wasteTypeId,
        weight: item.weight,
        price: wasteType!.unitPrice,
        subtotal,
      };
    });

    // 3. Mock AI Results (Volume Estimation & Vehicle Recommendation)
    const totalWeight = wasteItems.reduce((acc, item) => acc + item.weight, 0);
    const volumeEstimation = totalWeight * 1.2; // Mock calculation
    const recommendedVehicle = totalWeight > 10 ? 'PICKUP' : 'MOTOR';
    const confidenceScore = 0.85 + Math.random() * 0.1;

    // 4. Create Order and related records in a transaction
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId,
          addressId,
          scheduleType,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          note,
          status: OrderStatus.CREATED,
          totalCredit,
          wasteItems: {
            create: processedWasteItems,
          },
          aiResults: {
            create: {
              volumeEstimation,
              recommendedVehicle,
              confidenceScore,
              objectDetected: { items: wasteTypes.map(w => w.name) },
            },
          },
        },
        include: {
          wasteItems: true,
          aiResults: true,
          address: true,
        },
      });

      return order;
    });
  }

  async findAll(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        address: true,
        wasteItems: {
          include: { wasteType: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: {
        address: true,
        wasteItems: {
          include: { wasteType: true },
        },
        aiResults: true,
        courier: {
          include: { user: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }
}
