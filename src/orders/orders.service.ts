import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { XenditService } from '../xendit/xendit.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AiAnalyzeDto } from './dto/ai-analyze.dto';
import { SubmitWeighingDto } from './dto/submit-weighing.dto';
import { PayOrderDto, PaymentMethod } from './dto/pay-order.dto';
import { Order, OrderStatus, OrderAiResult, Role, VehicleType, WalletTransactionType, WalletReferenceType, TransactionStatus, PaymentStatus } from '../generated/prisma';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly xenditService: XenditService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(userId: string, createOrderDto: CreateOrderDto): Promise<Order> {
    const { addressId, scheduleType, scheduledAt, note, aiResultId } = createOrderDto;

    // 1. Verify address belongs to user
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found or does not belong to user');
    }

    // 2. Handle Schedule Logic
    // If INSTANT, always set scheduledAt to null
    const finalScheduledAt = scheduleType === 'INSTANT' ? null : (scheduledAt ? new Date(scheduledAt) : null);

    // 3. Mock AI Results (Only if NOT provided)
    let aiData: any = null;
    if (!aiResultId) {
      const volumeEstimation = 5 + Math.random() * 10;
      const recommendedVehicle = volumeEstimation > 12 ? 'PICKUP' : 'MOTOR';
      const confidenceScore = 0.90 + Math.random() * 0.08;
      aiData = {
        volumeEstimation,
        recommendedVehicle,
        confidenceScore,
      };
    }

    // 4. Create Order and related records in a transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          userId,
          addressId,
          scheduleType,
          scheduledAt: finalScheduledAt,
          note,
          status: OrderStatus.CREATED,
          totalCredit: 0, // Starts at 0 until courier weighs it
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
    
    if (role === Role.COURIER) {
      const courier = await this.prisma.courier.findFirst({ where: { userId } });
      if (courier) {
        where.courierId = courier.id;
      } else {
        where.userId = userId; // Fallback
      }
    } else if (role !== Role.ADMIN) {
      where.userId = userId;
    }

    const order = await this.prisma.order.findFirst({
      where,
      include: {
        address: true,
        wasteItems: { include: { wasteType: true } },
        residuals: true,
        payments: { orderBy: { createdAt: 'desc' } },
        aiResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        statusHistory: { orderBy: { createdAt: 'desc' } },
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

    // 1. Permission check
    let isAllowed = false;
    let courierId: string | null = null;

    if (role === Role.ADMIN) {
      isAllowed = true;
    } else if (role === Role.USER && order.userId === userId) {
      isAllowed = true;
    } else if (role === Role.COURIER) {
      const courier = await this.prisma.courier.findFirst({ where: { userId } });
      if (courier && order.courierId === courier.id) {
        isAllowed = true;
        courierId = courier.id;
      }
    }

    if (!isAllowed) {
      throw new BadRequestException('Anda tidak memiliki izin untuk membatalkan pesanan ini');
    }

    // 2. Status check based on Role
    if (role === Role.USER) {
      const userBlockedStatuses: OrderStatus[] = [
        OrderStatus.ARRIVED,
        OrderStatus.WEIGHING,
        OrderStatus.PICKED_UP,
        OrderStatus.DELIVERING,
        OrderStatus.COMPLETED,
      ];
      if (userBlockedStatuses.includes(order.status)) {
        throw new BadRequestException('User tidak bisa membatalkan pesanan setelah kurir tiba (ARRIVED)');
      }
    }

    if (role === Role.COURIER) {
      const courierBlockedStatuses: OrderStatus[] = [
        OrderStatus.PICKED_UP,
        OrderStatus.DELIVERING,
        OrderStatus.COMPLETED,
      ];
      if (courierBlockedStatuses.includes(order.status)) {
        throw new BadRequestException('Kurir tidak bisa membatalkan pesanan setelah sampah diangkut (PICKED_UP)');
      }
    }

    // Fallback for any other cases (Completed or already cancelled)
    if (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException(`Pesanan sudah dalam status ${order.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      let cancelledByValue: 'USER' | 'COURIER' | 'SYSTEM' = 'SYSTEM';
      if (role === Role.USER) cancelledByValue = 'USER';
      if (role === Role.COURIER) cancelledByValue = 'COURIER';

      await tx.orderCancellation.create({
        data: {
          orderId,
          cancelledBy: cancelledByValue,
          reason: reason || `Dibatalkan oleh ${role.toLowerCase()}`,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: OrderStatus.CANCELLED,
          note: reason || 'Pesanan dibatalkan',
        },
      });

      // 3. Refund Logic: Jika sudah ada pembayaran PAID, kembalikan ke wallet user
      const payment = await tx.payment.findFirst({
        where: { orderId, status: PaymentStatus.PAID },
      });

      if (payment) {
        await this.walletService.creditCourierOrder(
          order.userId,
          orderId,
          payment.amount,
          `Pengembalian dana (refund) pembatalan order #${orderId.slice(0, 8)}`,
        );
      }

      return { message: 'Order successfully cancelled and refunded if applicable' };
    });
  }

  async getTimeline(id: string, userId: string, role: string) {
    const where: any = { id };
    
    if (role === Role.COURIER) {
      const courier = await this.prisma.courier.findFirst({ where: { userId } });
      if (courier) where.courierId = courier.id;
    } else if (role !== Role.ADMIN) {
      where.userId = userId;
    }

    const order = await this.prisma.order.findFirst({
      where,
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
    }));
  }

  async analyzeAndSaveAiResult(data: AiAnalyzeDto): Promise<OrderAiResult> {
    // Randomized logic based on manualHint if available
    let baseVolume = 5;
    if (data.manualHint?.toLowerCase().includes('banyak')) baseVolume = 15;
    if (data.manualHint?.toLowerCase().includes('sedikit')) baseVolume = 2;

    const volumeEstimation = baseVolume + Math.random() * 10;
    const recommendedVehicle = volumeEstimation > 12 ? 'PICKUP' : 'MOTOR';
    const confidenceScore = 0.90 + Math.random() * 0.08; // Higher confidence for mock

    return this.prisma.orderAiResult.create({
      data: {
        volumeEstimation,
        recommendedVehicle,
        confidenceScore,
      },
    });
  }

  async autoAssignCourier(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { 
        address: true,
        aiResults: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
    });

    if (!order || !order.address.latitude || !order.address.longitude) return;

    const { latitude, longitude } = order.address;
    const radii = [2000, 5000]; // 2km dan 5km

    for (let i = 0; i < radii.length; i++) {
      const radius = radii[i];
      
      // Pencarian kurir terdekat yang Online via PostGIS
      const couriers: any[] = await this.prisma.$queryRaw`
        SELECT c.id, c.user_id,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(CAST(c.current_lng AS float8), CAST(c.current_lat AS float8)), 4326)::geography,
            ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
          ) as distance
        FROM couriers c
        WHERE c.is_online = true
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(CAST(c.current_lng AS float8), CAST(c.current_lat AS float8)), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${radius}
        )
        ORDER BY distance ASC
        LIMIT 1
      `;

      if (couriers.length > 0) {
        const courier = couriers[0];
        
        await this.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: orderId },
            data: {
              courierId: courier.id,
              status: OrderStatus.MATCHED,
            },
          });

          await tx.orderStatusHistory.create({
            data: {
              orderId,
              status: OrderStatus.MATCHED,
              note: `Kurir ditemukan dalam radius ${radius/1000}km`,
            },
          });
        });

        // --- TASK N.5: Push Notification to Courier ---
        try {
          const weightInfo = order.aiResults[0]?.volumeEstimation 
            ? `~${order.aiResults[0].volumeEstimation.toFixed(1)}L` 
            : 'sejumlah';
            
          await this.notificationService.sendPushNotification({
            userId: courier.user_id,
            title: '🚛 Orderan Baru!',
            body: `Pickup sampah ${weightInfo} di ${order.address.district || 'lokasi Anda'} (${(courier.distance / 1000).toFixed(1)}km)`,
            type: 'NEW_ORDER',
            data: {
              orderId: orderId,
              action: 'OPEN_ORDER_DETAIL',
            },
          });
        } catch (error) {
          // Log error tapi jangan gagalkan proses assignment
          console.error('Failed to send notification to courier:', error);
        }

        return; 
      }

      if (i < radii.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10000)); 
      }
    }

    // Auto-cancel if no courier found
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: OrderStatus.CANCELLED,
          note: 'Pesanan dibatalkan otomatis karena tidak ada kurir di sekitar lokasi',
        },
      });
    });
  }

  // ==========================================
  // Story 4: Courier Order Actions
  // ==========================================

  /** Valid status transitions */
  private readonly validTransitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.CREATED]: [OrderStatus.MATCHED, OrderStatus.CANCELLED],
    [OrderStatus.MATCHED]: [OrderStatus.MATCHED, OrderStatus.ON_GOING, OrderStatus.REASSIGNING, OrderStatus.CANCELLED],
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
      include: { wasteItems: true },
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

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // 1. Buat history record dulu
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: newStatus,
          note,
          photoUrl,
        },
      });

      // 2. Jika status COMPLETED, proses dompet (wallet)
      if (newStatus === OrderStatus.COMPLETED && order.netTotal !== null) {
        const amount = Math.abs(order.netTotal);
        const description = order.netTotal >= 0 
          ? `Hasil penjualan sampah - Order #${order.id.slice(0, 8)}` 
          : `Biaya pengangkutan residu - Order #${order.id.slice(0, 8)}`;

        if (order.netTotal >= 0) {
          // User dapat uang
          await this.walletService.creditCourierOrder(order.userId, order.id, amount, description);
        } else {
          // User bayar (biasanya sudah dipotong saat WAITING_PAYMENT)
        }

        // --- TASK 4.2: Courier Earning (Dynamic) ---
        if (order.courierId) {
          const courier = await tx.courier.findUnique({
            where: { id: order.courierId },
            include: { user: true }
          });
          
          if (courier) {
            // 1. Base Fee berdasarkan kendaraan
            let baseFee = 5000; // Default MOTOR
            if (courier.vehicleType === VehicleType.PICKUP) baseFee = 15000;
            if (courier.vehicleType === VehicleType.TRUCK) baseFee = 30000;

            // 2. Weight Bonus (Rp 500 / kg sampah MUTU)
            const totalMutuWeight = order.wasteItems.reduce((acc, item) => acc + item.weight, 0);
            const weightBonus = Math.round(totalMutuWeight * 500);
            
            const totalEarning = baseFee + weightBonus;
            
            const courierDescription = `Komisi order #${order.id.slice(0, 8)} (Base ${courier.vehicleType}: ${baseFee.toLocaleString()} + Bonus Berat: ${weightBonus.toLocaleString()})`;
            await this.walletService.creditCourierOrder(courier.userId, order.id, totalEarning, courierDescription);
          }
        }
      }

      // 3. Update status order dan ambil data lengkapnya
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
          statusHistory: { orderBy: { createdAt: 'desc' } },
        },
      });
    });

    // --- TASK N.7: Push Notification to User on Status Update ---
    try {
      const userNotificationMap: Partial<Record<OrderStatus, { title: string; body: string }>> = {
        [OrderStatus.MATCHED]: {
          title: '✅ Kurir Ditemukan',
          body: `Kurir telah menyetujui pesanan Anda dan akan segera berangkat.`,
        },
        [OrderStatus.ON_GOING]: {
          title: '🚛 Kurir Berangkat',
          body: `Kurir sedang menuju lokasi Anda.`,
        },
        [OrderStatus.ARRIVED]: {
          title: '📍 Kurir Tiba',
          body: `Kurir sudah sampai di lokasi Anda. Silakan siapkan sampah Anda.`,
        },
        [OrderStatus.COMPLETED]: {
          title: '🎉 Pesanan Selesai',
          body: `Terima kasih! Sampah Anda telah berhasil diproses. Saldo wallet Anda telah terupdate.`,
        },
      };

      const notifContent = userNotificationMap[newStatus];
      if (notifContent) {
        await this.notificationService.sendPushNotification({
          userId: order.userId,
          title: notifContent.title,
          body: notifContent.body,
          type: 'ORDER_UPDATE',
          data: {
            orderId: orderId,
            status: newStatus,
          },
        });
      }
    } catch (error) {
      console.error('Failed to send status update notification to user:', error);
    }

    return updatedOrder;
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
  async getLatestTracking(orderId: string, userId: string, role: string) {
    const where: any = { id: orderId };
    
    if (role === Role.COURIER) {
      const courier = await this.prisma.courier.findFirst({ where: { userId } });
      if (courier) where.courierId = courier.id;
    } else if (role !== Role.ADMIN) {
      where.userId = userId;
    }

    const order = await this.prisma.order.findFirst({
      where,
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

  async submitWeighing(
    orderId: string, 
    courierId: string, 
    data: SubmitWeighingDto,
    photoUrl?: string
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { wasteItems: true, residuals: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.courierId !== courierId) throw new BadRequestException('Order is not assigned to you');

    if (order.status !== OrderStatus.ARRIVED && order.status !== OrderStatus.WEIGHING) {
      throw new BadRequestException(`Cannot submit weighing in ${order.status} status`);
    }

    let mutuItems = data.mutuItems || [];
    let residualWeight = data.residualWeight || 0;

    // AUTO-MOCK/HARDCODE LOGIC
    if (mutuItems.length === 0 && residualWeight === 0 && !photoUrl) {
      const allMutuTypes = await this.prisma.wasteType.findMany({ where: { category: 'MUTU' } });
      if (allMutuTypes.length > 0) {
        const randomType = allMutuTypes[Math.floor(Math.random() * allMutuTypes.length)];
        mutuItems = [{
          wasteTypeId: randomType.id,
          weight: Number((3 + Math.random() * 7).toFixed(2)),
        }];
      }
      residualWeight = Number((1 + Math.random() * 2).toFixed(2));
    }

    const processedMutuItems: any[] = [];
    let totalCredit = 0;
    let totalDebit = 0;

    // 1. Process Mutu Items
    if (mutuItems.length > 0) {
      const mutuTypeIds = mutuItems.map(i => i.wasteTypeId);
      const mutuTypes = await this.prisma.wasteType.findMany({
        where: { id: { in: mutuTypeIds } }
      });

      for (const item of mutuItems) {
        const type = mutuTypes.find(t => t.id === item.wasteTypeId);
        if (!type) throw new BadRequestException(`Jenis sampah mutu dengan ID ${item.wasteTypeId} tidak ditemukan`);
        
        const subtotal = item.weight * type.unitPrice;
        totalCredit += subtotal;
        processedMutuItems.push({
          wasteTypeId: item.wasteTypeId,
          weight: item.weight,
          price: type.unitPrice,
          subtotal,
        });
      }
    }

    // 2. Process Residual (Save to OrderResidual)
    let residualData: any = null;
    if (residualWeight > 0) {
      const residuType = await this.prisma.wasteType.findFirst({
        where: { category: 'RESIDU' },
        orderBy: { createdAt: 'asc' }
      });

      if (!residuType) {
        throw new BadRequestException('Kategori sampah RESIDU belum dikonfigurasi di database.');
      }

      const subtotal = residualWeight * residuType.unitPrice;
      totalDebit += subtotal;
      residualData = {
        weight: residualWeight,
        pricePerKg: residuType.unitPrice,
        subtotal,
        photoUrl: photoUrl || null,
      };
    }

    if (processedMutuItems.length === 0 && !residualData) {
      throw new BadRequestException('Harap masukkan setidaknya satu data timbangan (Mutu atau Residu)');
    }

    const netTotal = totalCredit - totalDebit;
    const nextStatus = netTotal < 0 ? OrderStatus.WAITING_PAYMENT : OrderStatus.PICKED_UP;

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Cleanup
      await tx.orderWasteItem.deleteMany({ where: { orderId } });
      await tx.orderResidual.deleteMany({ where: { orderId } });

      const result = await tx.order.update({
        where: { id: orderId },
        data: {
          totalCredit,
          totalDebit,
          netTotal,
          status: nextStatus,
          wasteItems: {
            create: processedMutuItems,
          },
          residuals: residualData ? {
            create: residualData,
          } : undefined,
          statusHistory: {
            create: {
              status: nextStatus,
              note: `Triage selesai. Net Total: ${netTotal.toLocaleString()}. Status: ${nextStatus}`,
              photoUrl: photoUrl,
            },
          },
        },
        include: {
          wasteItems: { include: { wasteType: true } },
          residuals: true,
          statusHistory: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      });

      return result;
    });

    // --- TASK N.7: Notify User after Weighing is Complete ---
    try {
      if (nextStatus === OrderStatus.WAITING_PAYMENT) {
        await this.notificationService.sendPushNotification({
          userId: order.userId,
          title: '💰 Pembayaran Diperlukan',
          body: `Timbangan selesai. Silakan bayar Rp ${Math.abs(netTotal).toLocaleString()} untuk biaya residu agar sampah bisa diangkut.`,
          type: 'PAYMENT_REQUIRED',
          data: { orderId: orderId },
        });
      } else if (nextStatus === OrderStatus.PICKED_UP) {
        await this.notificationService.sendPushNotification({
          userId: order.userId,
          title: '🚛 Sampah Diangkut',
          body: `Timbangan selesai. Kurir telah mengangkut sampah Anda.`,
          type: 'ORDER_UPDATE',
          data: { orderId: orderId },
        });
      }
    } catch (error) {
      console.error('Failed to notify user after weighing:', error);
    }

    return updatedOrder;
  }

  async payOrder(orderId: string, userId: string, data: PayOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new BadRequestException('Not your order');
    if (order.status !== OrderStatus.WAITING_PAYMENT) {
      throw new BadRequestException(`Order is not in WAITING_PAYMENT status (current: ${order.status})`);
    }

    if (!order.netTotal || order.netTotal >= 0) {
      throw new BadRequestException('Order does not require payment');
    }

    const amount = Math.abs(order.netTotal);

    if (data.method === PaymentMethod.WALLET) {
      await this.walletService.processOrderPayment(
        userId,
        orderId,
        amount,
        `Pembayaran pesanan #${orderId.slice(0, 8)}`,
      );

      const updatedOrder = await this.prisma.$transaction(async (tx) => {
        // Create Payment record
        await tx.payment.create({
          data: {
            orderId,
            userId,
            amount,
            method: 'WALLET',
            status: PaymentStatus.PAID,
            externalId: `PAY-WL-${Date.now()}-${orderId.slice(0, 4)}`,
            paidAt: new Date(),
          },
        });

        // Update Order
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.PICKED_UP,
            statusHistory: {
              create: {
                status: OrderStatus.PICKED_UP,
                note: `Pembayaran via Wallet berhasil seharga Rp ${amount.toLocaleString()}`,
              },
            },
          },
        });

        return updatedOrder;
      });

      // --- TASK N.7: Notify Courier about Payment ---
      if (order.courierId) {
        try {
          const courier = await this.prisma.courier.findUnique({
            where: { id: order.courierId },
          });
          if (courier) {
            await this.notificationService.sendPushNotification({
              userId: courier.userId,
              title: '💰 Pembayaran Diterima',
              body: `User telah membayar Rp ${amount.toLocaleString()}. Silakan lanjutkan pengangkutan.`,
              type: 'PAYMENT_SUCCESS',
              data: { orderId: orderId },
            });
          }
        } catch (error) {
          console.error('Failed to notify courier about payment:', error);
        }
      }

      return updatedOrder;
    }

    // --- XENDIT PAYMENT (QRIS, E-WALLET, etc) ---
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const externalId = `INV-${orderId.slice(0, 8)}-${Date.now()}`;
    const description = `Pembayaran Angkutin Order #${orderId.slice(0, 8)}`;

    const xenditInvoice = await this.xenditService.createInvoice({
      externalId,
      amount,
      payerEmail: user?.email,
      description,
    });

    return this.prisma.payment.create({
      data: {
        orderId,
        userId,
        amount,
        method: data.method,
        status: PaymentStatus.PENDING,
        externalId,
        gatewayId: xenditInvoice.id,
        invoiceUrl: xenditInvoice.invoiceUrl,
        expiredAt: new Date(xenditInvoice.expiryDate),
      },
    });
  }

  async handlePaymentSuccess(externalId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { externalId },
      include: { order: true },
    });

    if (!payment) return;
    if (payment.status === PaymentStatus.PAID) return; // Idempotent

    return this.prisma.$transaction(async (tx) => {
      // 1. Update Payment
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
        },
      });

      // 2. Update Order
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: OrderStatus.PICKED_UP,
          statusHistory: {
            create: {
              status: OrderStatus.PICKED_UP,
              note: `Pembayaran via Xendit (${payment.method}) berhasil.`,
            },
          },
        },
      });
    });
  }

  async handlePaymentExpired(externalId: string) {
    await this.prisma.payment.update({
      where: { externalId },
      data: { status: PaymentStatus.EXPIRED },
    });
  }

  async getPaymentStatus(orderId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      throw new NotFoundException('Payment record not found for this order');
    }

    return payment;
  }
}
