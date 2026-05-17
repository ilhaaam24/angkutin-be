import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Prisma } from '../generated/prisma';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findOne(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findOneById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data,
      });

      // Auto-create wallet
      await tx.wallet.create({
        data: {
          userId: user.id,
          balance: 0,
        },
      });

      return user;
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async getPointSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totalPoints: true },
    });

    const history = await this.prisma.pointTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: { id: true, createdAt: true },
        },
      },
    });

    return {
      totalPoints: user?.totalPoints || 0,
      history,
    };
  }
}