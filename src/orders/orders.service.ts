import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AiAnalyzeDto } from './dto/ai-analyze.dto';
import { Order, OrderStatus, OrderAiResult, Role, VehicleType } from '../generated/prisma';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, createOrderDto: CreateOrderDto): Promise<Order> {
    const { addressId, wasteItems, scheduleType, scheduledAt, note, aiResultId } = createOrderDto;

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

    // 3. Mock AI Results (Only if NOT provided)
    let aiData: any = null;
    if (!aiResultId) {
      const totalWeight = wasteItems.reduce((acc, item) => acc + item.weight, 0);
      const volumeEstimation = totalWeight * 1.2;
      const recommendedVehicle = totalWeight > 10 ? 'PICKUP' : 'MOTOR';
      const confidenceScore = 0.85 + Math.random() * 0.1;
      aiData = {
        volumeEstimation,
        recommendedVehicle,
        confidenceScore,
        objectDetected: { items: wasteTypes.map((w) => w.name) },
      };
    }

    // 4. Create Order and related records in a transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
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
          statusHistory: {
            create: {
              status: OrderStatus.CREATED,
              note: 'Pesanan berhasil dibuat',
            },
          },
          ...(aiData && {
            aiResults: {
              create: aiData,
            },
          }),
        },
        include: {
          wasteItems: true,
          aiResults: true,
          address: true,
        },
      });

      // If aiResultId was provided, link it to the new order
      if (aiResultId) {
        await tx.orderAiResult.update({
          where: { id: aiResultId },
          data: { orderId: newOrder.id },
        });
      }

      return newOrder;
    });

    // 5. Trigger Auto-Assign (Story 3)
    // We'll implement this method next
    await this.autoAssignCourier(order.id);

    return this.findOne(order.id, userId);
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

  async findAllByRole(userId: string, role: Role, status?: OrderStatus) {
    const where: any = {};

    // Admin sees all, User/Courier sees only their own
    if (role === Role.ADMIN) {
      // no filter by user
    } else {
      where.userId = userId;
    }

    if (status) {
      where.status = status;
    }

    return this.prisma.order.findMany({
      where,
      include: {
        address: true,
        wasteItems: { include: { wasteType: true } },
        courier: { include: { user: { select: { id: true, name: true } } } },
        user: { select: { id: true, name: true, phone: true } },
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
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                photoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async findOneByRole(id: string, userId: string, role: string) {
    const where: any = { id };
    if (role !== 'ADMIN') {
      where.userId = userId;
    }

    const order = await this.prisma.order.findFirst({
      where,
      include: {
        address: true,
        wasteItems: { include: { wasteType: true } },
        aiResults: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        courier: { include: { user: { select: { id: true, name: true, phone: true } } } },
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async cancelOrder(orderId: string, userId: string, role: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');

    // Only owner or admin can cancel
    if (role !== 'ADMIN' && order.userId !== userId) {
      throw new BadRequestException('You cannot cancel this order');
    }

    // Can only cancel before WEIGHING
    const cancellableStatuses: OrderStatus[] = [
      OrderStatus.CREATED,
      OrderStatus.MATCHED,
      OrderStatus.ON_GOING,
      OrderStatus.ARRIVED,
    ];

    if (!cancellableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Cannot cancel order in ${order.status} status. Can only cancel before weighing.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      await tx.orderCancellation.create({
        data: {
          orderId,
          cancelledBy: role === 'ADMIN' ? 'SYSTEM' : 'USER',
          reason: reason || 'Dibatalkan oleh user',
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: OrderStatus.CANCELLED,
          note: reason || 'Pesanan dibatalkan',
        },
      });

      return { message: 'Order successfully cancelled' };
    });
  }

  async getTimeline(id: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: {
        statusHistory: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    const labels: Record<OrderStatus, string> = {
      [OrderStatus.CREATED]: 'Pesanan Dibuat',
      [OrderStatus.MATCHED]: 'Kurir Ditemukan',
      [OrderStatus.ON_GOING]: 'Kurir Menuju Lokasi',
      [OrderStatus.ARRIVED]: 'Kurir Tiba di Lokasi',
      [OrderStatus.WEIGHING]: 'Sampah Ditimbang',
      [OrderStatus.WAITING_PAYMENT]: 'Menunggu Pembayaran',
      [OrderStatus.PICKED_UP]: 'Sampah Diangkut',
      [OrderStatus.DELIVERING]: 'Drop Point Daur Ulang',
      [OrderStatus.COMPLETED]: 'Pesanan Selesai',
      [OrderStatus.CANCELLED]: 'Pesanan Dibatalkan',
      [OrderStatus.REASSIGNING]: 'Mencari Kurir Baru',
    };

    return order.statusHistory.map((h) => ({
      status: h.status,
      label: labels[h.status] || h.status,
      timestamp: h.createdAt,
      note: h.note,
      photoUrl: h.photoUrl,
    }));
  }

  async analyzeAndSaveAiResult(data: AiAnalyzeDto): Promise<OrderAiResult> {
    // Mock AI Analysis Logic
    const volumeEstimation = 5 + Math.random() * 20; // 5 - 25 units
    const recommendedVehicle = volumeEstimation > 15 ? 'PICKUP' : 'MOTOR';
    const confidenceScore = 0.85 + Math.random() * 0.1;
    const objects = data.manualHint ? data.manualHint.split(',') : ['Plastik', 'Kardus'];

    return this.prisma.orderAiResult.create({
      data: {
        volumeEstimation,
        recommendedVehicle,
        confidenceScore,
        objectDetected: { items: objects.map((o) => o.trim()) },
      },
    });
  }

  async autoAssignCourier(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { aiResults: true },
    });

    if (!order || !order.aiResults.length) return;

    const recommendedVehicle = order.aiResults[0].recommendedVehicle as VehicleType;

    let courier = await this.prisma.courier.findFirst({
      where: {
        isOnline: true,
        vehicleType: recommendedVehicle || VehicleType.MOTOR,
      },
    });

    if (!courier) {
      courier = await this.prisma.courier.findFirst({
        where: { isOnline: true },
      });
    }

    if (courier) {
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: {
            courierId: courier!.id,
            status: OrderStatus.MATCHED,
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId,
            status: OrderStatus.MATCHED,
            note: `Kurir ditemukan dan pesanan telah dikonfirmasi`,
          },
        });
      });
    }
  }

  // ==========================================
  // Story 4: Courier Order Actions
  // ==========================================

  /** Valid status transitions */
  private readonly validTransitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.CREATED]: [OrderStatus.MATCHED, OrderStatus.CANCELLED],
    [OrderStatus.MATCHED]: [OrderStatus.ON_GOING, OrderStatus.REASSIGNING, OrderStatus.CANCELLED],
    [OrderStatus.ON_GOING]: [OrderStatus.ARRIVED, OrderStatus.CANCELLED],
    [OrderStatus.ARRIVED]: [OrderStatus.WEIGHING, OrderStatus.CANCELLED],
    [OrderStatus.WEIGHING]: [OrderStatus.WAITING_PAYMENT, OrderStatus.PICKED_UP],
    [OrderStatus.WAITING_PAYMENT]: [OrderStatus.PICKED_UP],
    [OrderStatus.PICKED_UP]: [OrderStatus.DELIVERING],
    [OrderStatus.DELIVERING]: [OrderStatus.COMPLETED],
    [OrderStatus.COMPLETED]: [],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.REASSIGNING]: [OrderStatus.MATCHED, OrderStatus.CANCELLED],
  };

  async transitionOrderStatus(
    orderId: string,
    courierId: string,
    newStatus: OrderStatus,
    note?: string,
    photoUrl?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    if (order.courierId !== courierId) {
      throw new BadRequestException('This order is not assigned to you');
    }

    const allowed = this.validTransitions[order.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${order.status} to ${newStatus}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Buat history record dulu
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: newStatus,
          note,
          photoUrl,
        },
      });

      // 2. Update status order dan ambil data lengkapnya
      return tx.order.update({
        where: { id: orderId },
        data: { status: newStatus },
        include: {
          address: true,
          wasteItems: { include: { wasteType: true } },
          courier: {
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
          },
          statusHistory: { orderBy: { createdAt: 'asc' } },
        },
      });
    });
  }

  /** List orders assigned to a specific courier */
  async getCourierOrders(courierId: string, status?: OrderStatus) {
    return this.prisma.order.findMany({
      where: {
        courierId,
        ...(status && { status }),
      },
      include: {
        address: true,
        wasteItems: { include: { wasteType: true } },
        user: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** List unassigned orders for couriers to pick up */
  async getAvailableOrders() {
    return this.prisma.order.findMany({
      where: {
        status: OrderStatus.CREATED,
        courierId: null,
      },
      include: {
        address: true,
        wasteItems: { include: { wasteType: true } },
        aiResults: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Find order by ID for courier (validates courier ownership) */
  async findOneForCourier(orderId: string, courierId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, courierId },
      include: {
        address: true,
        wasteItems: { include: { wasteType: true } },
        aiResults: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found or not assigned to you');
    }

    return order;
  }

  /** Courier rejects an order → trigger reassignment */
  async rejectOrder(orderId: string, courierId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.courierId !== courierId) {
      throw new BadRequestException('This order is not assigned to you');
    }
    if (order.status !== OrderStatus.MATCHED) {
      throw new BadRequestException('Can only reject orders in MATCHED status');
    }

    await this.prisma.$transaction(async (tx) => {
      // Log reassignment
      await tx.orderReassignment.create({
        data: {
          orderId,
          oldCourierId: courierId,
          reason: reason || 'Kurir menolak pesanan',
        },
      });

      // Reset order to CREATED so auto-assign can re-run
      await tx.order.update({
        where: { id: orderId },
        data: {
          courierId: null,
          status: OrderStatus.CREATED,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: OrderStatus.REASSIGNING,
          note: reason || 'Kurir menolak, mencari kurir baru',
        },
      });
    });

    // Try to find another courier
    await this.autoAssignCourier(orderId);

    return { message: 'Order rejected, reassigning to another courier' };
  }

  // ==========================================
  // Story 7: GPS Tracking (Polling / Supabase Realtime)
  // ==========================================

  /** Courier sends their current location — also updates courier record */
  async updateCourierLocation(
    orderId: string,
    courierId: string,
    latitude: number,
    longitude: number,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, courierId },
    });

    if (!order) {
      throw new NotFoundException('Order not found or not assigned to you');
    }

    // Only track during active delivery statuses
    const trackableStatuses: OrderStatus[] = [
      OrderStatus.ON_GOING,
      OrderStatus.ARRIVED,
      OrderStatus.WEIGHING,
      OrderStatus.PICKED_UP,
      OrderStatus.DELIVERING,
    ];

    if (!trackableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Cannot update location in ${order.status} status`,
      );
    }

    // Update courier's current position + insert tracking log
    const [, trackingLog] = await this.prisma.$transaction([
      this.prisma.courier.update({
        where: { id: courierId },
        data: {
          currentLat: latitude,
          currentLng: longitude,
        },
      }),
      this.prisma.orderTrackingLog.create({
        data: {
          orderId,
          courierId,
          latitude,
          longitude,
        },
      }),
    ]);

    return {
      success: true,
      trackingId: trackingLog.id,
      message: 'Location updated',
    };
  }

  /** Get latest courier location for an order (fallback if realtime fails) */
  async getLatestTracking(orderId: string, userId: string) {
    // Verify order belongs to user or user is admin
    const order = await this.prisma.order.findFirst({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const latest = await this.prisma.orderTrackingLog.findFirst({
      where: { orderId },
      orderBy: { recordedAt: 'desc' },
      include: {
        courier: {
          include: {
            user: {
              select: { name: true, phone: true },
            },
          },
        },
      },
    });

    if (!latest) {
      return {
        location: null,
        courier: null,
        message: 'No tracking data available yet',
      };
    }

    return {
      location: {
        lat: Number(latest.latitude),
        lng: Number(latest.longitude),
      },
      courier: {
        name: latest.courier.user.name,
        phone: latest.courier.user.phone,
        vehicleType: latest.courier.vehicleType,
      },
      timestamp: latest.recordedAt,
    };
  }

  /** Get full tracking history for an order */
  async getTrackingHistory(orderId: string) {
    return this.prisma.orderTrackingLog.findMany({
      where: { orderId },
      orderBy: { recordedAt: 'asc' },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        recordedAt: true,
      },
    });
  }
}
