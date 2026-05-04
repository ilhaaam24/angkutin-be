import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Courier, Prisma } from '../generated/prisma';

@Injectable()
export class CouriersService {
  constructor(private prisma: PrismaService) {}

  async register(userId: string, data: { vehicleType: any }): Promise<Courier> {
    // Check if already a courier
    const existing = await this.prisma.courier.findFirst({
      where: { userId },
    });

    if (existing) {
      throw new BadRequestException('User is already registered as a courier');
    }

    // Create courier record and update user role
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role: 'COURIER' },
      });

      return tx.courier.create({
        data: {
          vehicleType: data.vehicleType,
          user: { connect: { id: userId } },
        },
      });
    });
  }

  async getProfile(userId: string): Promise<Courier | null> {
    return this.prisma.courier.findFirst({
      where: { userId },
    });
  }

  async updateStatus(userId: string, isOnline: boolean): Promise<Courier> {
    const courier = await this.getProfile(userId);
    if (!courier) throw new BadRequestException('Courier record not found');

    return this.prisma.courier.update({
      where: { id: courier.id },
      data: { isOnline },
    });
  }
}
