import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderStatus,
  WithdrawalStatus,
  WalletTransactionType,
  WalletReferenceType,
  TransactionStatus,
  UserStatus,
  WasteCategory,
} from '../generated/prisma';
import { AdminUpdateUserDto } from './dto/update-user.dto';
import { AdminCreateWasteTypeDto } from './dto/create-waste-type.dto';
import { CouriersService } from '../couriers/couriers.service';
import { AdminCreateCourierDto } from '../couriers/dto/admin-create-courier.dto';
import { UpdateCourierDto } from '../couriers/dto/update-courier.dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private couriersService: CouriersService,
  ) {}

  // ============================================
  // 1. DASHBOARD & ANALYTICS
  // ============================================

  async getAnalyticsSummary() {
    const [
      totalOrders,
      totalCompletedOrders,
      activeCouriers,
      pendingWithdrawals,
      wasteItems,
      residuals,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.prisma.courier.count({ where: { isOnline: true } }),
      this.prisma.withdrawal.count({ where: { status: WithdrawalStatus.PENDING } }),
      this.prisma.orderWasteItem.aggregate({
        _sum: { weight: true, subtotal: true },
        where: {
          order: { status: OrderStatus.COMPLETED },
        },
      }),
      this.prisma.orderResidual.aggregate({
        _sum: { weight: true, subtotal: true },
        where: {
          order: { status: OrderStatus.COMPLETED },
        },
      }),
    ]);

    const totalMutuKg = wasteItems._sum.weight ?? 0;
    const totalResiduKg = residuals._sum.weight ?? 0;
    const totalRevenue = (wasteItems._sum.subtotal ?? 0) + (residuals._sum.subtotal ?? 0);

    return {
      totalOrders,
      totalCompletedOrders,
      totalRevenue,
      totalMutuKg,
      totalResiduKg,
      activeCouriers,
      pendingWithdrawals,
    };
  }

  async getAnalyticsCharts(range: '7d' | '30d') {
    const days = range === '7d' ? 7 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Get completed orders in the range
    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.COMPLETED,
        createdAt: { gte: startDate },
      },
      include: {
        wasteItems: {
          include: { wasteType: true },
        },
        residuals: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const dateMap = new Map<string, {
      mutuKg: number;
      residuKg: number;
      revenue: number;
      beban: number;
    }>();

    // Initialize all days
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const key = date.toISOString().split('T')[0];
      dateMap.set(key, { mutuKg: 0, residuKg: 0, revenue: 0, beban: 0 });
    }

    for (const order of orders) {
      const key = order.createdAt.toISOString().split('T')[0];
      const entry = dateMap.get(key);
      if (!entry) continue;

      // Mutu items
      for (const item of order.wasteItems) {
        if (item.wasteType.category === WasteCategory.MUTU) {
          entry.mutuKg += item.weight;
          entry.revenue += item.subtotal;
        } else {
          entry.residuKg += item.weight;
          entry.beban += item.subtotal;
        }
      }

      // Residuals always count as residu/beban
      for (const residual of order.residuals) {
        entry.residuKg += residual.weight;
        entry.beban += residual.subtotal;
      }
    }

    const barChart: { date: string; mutuKg: number; residuKg: number }[] = [];
    const areaChart: { date: string; revenue: number; beban: number }[] = [];

    dateMap.forEach((val, date) => {
      barChart.push({ date, mutuKg: val.mutuKg, residuKg: val.residuKg });
      areaChart.push({ date, revenue: val.revenue, beban: val.beban });
    });

    return { barChart, areaChart };
  }

  // ============================================
  // 2. USER MANAGEMENT
  // ============================================

  async getAllUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        phone: true,
        isVerified: true,
        photoUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { orders: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUser(id: string, data: AdminUpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        phone: true,
        isVerified: true,
        photoUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    if (user.role === 'ADMIN') {
      throw new BadRequestException('Cannot delete admin users');
    }

    // Cascade delete related data in a transaction
    return this.prisma.$transaction(async (tx) => {
      // Delete courier records if exists
      await tx.courier.deleteMany({ where: { userId: id } });

      // Delete addresses
      await tx.address.deleteMany({ where: { userId: id } });

      // Delete wallet transactions
      const wallet = await tx.wallet.findUnique({ where: { userId: id } });
      if (wallet) {
        await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
        await tx.wallet.delete({ where: { id: wallet.id } });
      }

      // Delete withdrawal records
      await tx.withdrawal.deleteMany({ where: { userId: id } });

      // Delete payment accounts
      await tx.userPaymentAccount.deleteMany({ where: { userId: id } });

      // Delete notifications
      await tx.notification.deleteMany({ where: { userId: id } });

      // Delete terminal validations
      await tx.terminalValidation.deleteMany({ where: { scannedBy: id } });

      // Finally delete user
      await tx.user.delete({ where: { id } });

      return { message: 'User and all associated data successfully deleted' };
    });
  }

  // ============================================
  // 3. FINANCE & WITHDRAWALS
  // ============================================

  async getTransactions() {
    return this.prisma.walletTransaction.findMany({
      include: {
        wallet: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getWithdrawals() {
    return this.prisma.withdrawal.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveWithdrawal(id: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException(`Withdrawal with ID ${id} not found`);

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve withdrawal in ${withdrawal.status} status. Only PENDING withdrawals can be approved.`,
      );
    }

    return this.prisma.withdrawal.update({
      where: { id },
      data: {
        status: WithdrawalStatus.SUCCESS,
        processedAt: new Date(),
      },
    });
  }

  async rejectWithdrawal(id: string, reason: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException(`Withdrawal with ID ${id} not found`);

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(
        `Cannot reject withdrawal in ${withdrawal.status} status. Only PENDING withdrawals can be rejected.`,
      );
    }

    // Refund the balance back to wallet
    return this.prisma.$transaction(async (tx) => {
      // 1. Update withdrawal status
      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id },
        data: {
          status: WithdrawalStatus.FAILED,
          failureReason: reason,
          processedAt: new Date(),
        },
      });

      // 2. Refund balance to wallet
      const wallet = await tx.wallet.findUnique({
        where: { userId: withdrawal.userId },
      });

      if (wallet) {
        // Create refund transaction
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTransactionType.CREDIT,
            amount: withdrawal.amount,
            referenceType: WalletReferenceType.WITHDRAWAL,
            referenceId: id,
            status: TransactionStatus.SUCCESS,
            description: `Refund: Withdrawal rejected - ${reason}`,
          },
        });

        // Increment wallet balance
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { increment: withdrawal.amount },
          },
        });
      }

      return updatedWithdrawal;
    });
  }

  // ============================================
  // 4. WASTE PRICING
  // ============================================

  async getWasteTypes() {
    return this.prisma.wasteType.findMany({
      include: {
        pricing: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { wasteItems: true },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async createWasteType(data: AdminCreateWasteTypeDto) {
    return this.prisma.wasteType.create({
      data: {
        name: data.name,
        category: data.category,
        unitPrice: data.unitPrice,
      },
    });
  }

  // ============================================
  // 5. FLEET & LIVE MONITORING
  // ============================================

  async getFleetLocations() {
    const couriers = await this.prisma.courier.findMany({
      where: {
        isOnline: true,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            photoUrl: true,
          },
        },
        orders: {
          where: {
            status: {
              in: [
                OrderStatus.MATCHED,
                OrderStatus.ON_GOING,
                OrderStatus.ARRIVED,
                OrderStatus.WEIGHING,
                OrderStatus.PICKED_UP,
                OrderStatus.DELIVERING,
              ],
            },
          },
          select: {
            id: true,
            status: true,
            address: {
              select: {
                addressDetail: true,
                district: true,
                village: true,
              },
            },
          },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return couriers.map((courier) => ({
      courierId: courier.id,
      name: courier.user.name,
      phone: courier.user.phone,
      photoUrl: courier.user.photoUrl,
      vehicleType: courier.vehicleType,
      vehiclePlate: courier.vehiclePlate,
      isOnline: courier.isOnline,
      location: courier.currentLat && courier.currentLng
        ? {
            lat: Number(courier.currentLat),
            lng: Number(courier.currentLng),
          }
        : null,
      activeOrder: courier.orders[0] ?? null,
    }));
  }

  // ============================================
  // 6. ORDERS MANAGEMENT (Admin-specific)
  // ============================================

  async getOrdersSummary() {
    const [total, created, matched, onGoing, completed, cancelled] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.CREATED } }),
      this.prisma.order.count({ where: { status: OrderStatus.MATCHED } }),
      this.prisma.order.count({
        where: {
          status: {
            in: [OrderStatus.ON_GOING, OrderStatus.ARRIVED, OrderStatus.WEIGHING, OrderStatus.PICKED_UP, OrderStatus.DELIVERING],
          },
        },
      }),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
    ]);

    return { total, created, matched, onGoing, completed, cancelled };
  }

  // ============================================
  // 7. COURIER MANAGEMENT
  // ============================================

  async getAllCouriers() {
    return this.couriersService.findAll();
  }

  async getCourierDetail(id: string) {
    return this.couriersService.findOne(id);
  }

  async createCourier(data: AdminCreateCourierDto) {
    return this.couriersService.adminCreate(data);
  }

  async updateCourier(id: string, data: UpdateCourierDto) {
    return this.couriersService.adminUpdate(id, data);
  }

  async removeCourier(id: string) {
    return this.couriersService.remove(id);
  }
}
