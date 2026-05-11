import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Courier, Prisma, Role } from '../generated/prisma';
import * as bcrypt from 'bcrypt';
import { AdminCreateCourierDto } from './dto/admin-create-courier.dto';

@Injectable()
export class CouriersService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<Courier[]> {
    return this.prisma.courier.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
    });
  }

  async findOne(id: string): Promise<Courier> {
    const courier = await this.prisma.courier.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    if (!courier) {
      throw new NotFoundException(`Courier with ID ${id} not found`);
    }

    return courier;
  }

  async register(userId: string, data: { vehicleType: any }): Promise<Courier> {
    const existing = await this.prisma.courier.findFirst({
      where: { userId },
    });

    if (existing) {
      throw new BadRequestException('User is already registered as a courier');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role: Role.COURIER },
      });

      return tx.courier.create({
        data: {
          vehicleType: data.vehicleType,
          user: { connect: { id: userId } },
        },
      });
    });
  }

  async adminCreate(data: AdminCreateCourierDto): Promise<Courier> {
    const { userId, email, password, name, phone, vehicleType, vehiclePlate } = data;

    // Skenario 1: Promosi User yang sudah ada
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      return this.register(userId, { vehicleType });
    }

    // Skenario 2: Onboarding Kurir Baru (Buat User + Kurir)
    if (!email || !password) {
      throw new BadRequestException('Either userId or (email and password) must be provided');
    }

    // Cek apakah email sudah terpakai
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new BadRequestException('Email already registered');

    const hashedPassword = await bcrypt.hash(password, 10);

    return this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          phone,
          role: Role.COURIER,
          isVerified: true, // Admin created accounts are pre-verified
        },
      });

      // Buat Wallet untuk Kurir baru
      await tx.wallet.create({
        data: {
          userId: newUser.id,
          balance: 0,
        },
      });

      return tx.courier.create({
        data: {
          vehicleType,
          vehiclePlate,
          user: { connect: { id: newUser.id } },
        },
      });
    });
  }

  async adminUpdate(id: string, data: Prisma.CourierUpdateInput): Promise<Courier> {
    try {
      return await this.prisma.courier.update({
        where: { id },
        data,
      });
    } catch (error) {
      throw new NotFoundException(`Courier with ID ${id} not found`);
    }
  }

  async remove(id: string): Promise<any> {
    const courier = await this.prisma.courier.findUnique({ where: { id } });
    if (!courier) throw new NotFoundException(`Courier with ID ${id} not found`);

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete Courier first (due to foreign key)
      await tx.courier.delete({
        where: { id },
      });

      // 2. Delete User
      await tx.user.delete({
        where: { id: courier.userId },
      });

      return { message: 'Courier and associated User successfully deleted' };
    });
  }

  async getProfile(userId: string): Promise<Courier | null> {
    return this.prisma.courier.findFirst({
      where: { userId },
      include: { user: true },
    });
  }

  async updateStatus(userId: string, isOnline: boolean): Promise<Courier> {
    const courier = await this.prisma.courier.findFirst({ where: { userId } });
    if (!courier) throw new BadRequestException('Courier record not found');

    return this.prisma.courier.update({
      where: { id: courier.id },
      data: { isOnline },
    });
  }

  async updateVehicle(userId: string, vehicleType: any): Promise<Courier> {
    const courier = await this.prisma.courier.findFirst({ where: { userId } });
    if (!courier) throw new BadRequestException('Courier record not found');

    return this.prisma.courier.update({
      where: { id: courier.id },
      data: { vehicleType },
    });
  }
}
