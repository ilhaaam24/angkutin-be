import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Address, Prisma } from '../generated/prisma';

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: { userId },
    });
  }

  async findOne(id: string, userId: string): Promise<Address | null> {
    return this.prisma.address.findFirst({
      where: { id, userId },
    });
  }

  async create(userId: string, data: Omit<Prisma.AddressCreateInput, 'user'>): Promise<Address> {
    // If setting as primary, unset other primary addresses for this user
    if (data.isPrimary) {
      await this.unsetPrimary(userId);
    }

    return this.prisma.address.create({
      data: {
        ...data,
        user: { connect: { id: userId } },
      },
    });
  }

  async update(id: string, userId: string, data: Prisma.AddressUpdateInput): Promise<Address> {
    // If setting as primary, unset other primary addresses for this user
    if (data.isPrimary) {
      await this.unsetPrimary(userId);
    }

    return this.prisma.address.update({
      where: { id, userId },
      data,
    });
  }

  async remove(id: string, userId: string): Promise<Address> {
    return this.prisma.address.delete({
      where: { id, userId },
    });
  }

  private async unsetPrimary(userId: string) {
    await this.prisma.address.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
}
