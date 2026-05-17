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

    // 5. Broadcast to eligible couriers (Gojek-style)
    this.broadcastToCouriers(order.id).catch(err => 
      console.error('Broadcast to couriers failed:', err),
    );

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
        courier: { include: { user: { select: { id: true, name: true, phone: true ,photoUrl: true} } } },
        user: { select: { id: true, name: true, phone: true ,photoUrl: true} },
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

  async broadcastToCouriers(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { 
        address: true,
        aiResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        user: { select: { name: true } },
      },
    });

    if (!order || !order.address.latitude || !order.address.longitude) return;

    const { latitude, longitude } = order.address;
    const radii = [3000, 5000]; // 3km lalu 5km

    // Tentukan filter kendaraan dari rekomendasi AI
    const recommendedVehicle = order.aiResults[0]?.recommendedVehicle || null;
    const vehicleFilter = recommendedVehicle 
      ? `AND c.vehicle_type = '${recommendedVehicle}'` 
      : '';

    for (let i = 0; i < radii.length; i++) {
      const radius = radii[i];

      // Cari SEMUA kurir eligible (online + dalam radius + kendaraan cocok)
      const couriers: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT c.id, c.user_id, c.vehicle_type,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(CAST(c.current_lng AS float8), CAST(c.current_lat AS float8)), 4326)::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          ) as distance
        FROM couriers c
        WHERE c.is_online = true
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(CAST(c.current_lng AS float8), CAST(c.current_lat AS float8)), 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
        ${vehicleFilter}
        ORDER BY distance ASC
      `, Number(longitude), Number(latitude), radius);

      if (couriers.length > 0) {
        // Kirim notifikasi ke SEMUA kurir (broadcast)
        const weightInfo = order.aiResults[0]?.volumeEstimation 
          ? `~${order.aiResults[0].volumeEstimation.toFixed(1)}L` 
          : 'sejumlah';

        for (const courier of couriers) {
          try {
            await this.notificationService.sendPushNotification({
              userId: courier.user_id,
              title: '🚛 Orderan Baru!',
              body: `Pickup sampah ${weightInfo} di ${order.address.district || 'lokasi user'} (${(courier.distance / 1000).toFixed(1)}km)`,
              type: 'NEW_ORDER',
              data: {
                orderId: orderId,
                action: 'OPEN_ORDER_DETAIL',
              },
            });
          } catch (error) {
            console.error(`Failed to notify courier ${courier.id}:`, error);
          }
        }

        console.log(`Broadcasted order ${orderId} to ${couriers.length} courir(s) within ${radius/1000}km`);
        return; // Selesai, tidak perlu coba radius berikutnya
      }

      // Tunggu sebelum coba radius berikutnya
      if (i < radii.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    // Tidak ada kurir ditemukan di semua radius → Auto-cancel
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

    // Notify user bahwa order dibatalkan
    try {
      await this.notificationService.sendPushNotification({
        userId: order.userId,
        title: '❌ Pesanan Dibatalkan',
        body: 'Maaf, tidak ada kurir yang tersedia di sekitar lokasi Anda saat ini.',
        type: 'ORDER_CANCELLED',
        data: { orderId },
      });
    } catch (error) {
      console.error('Failed to notify user about cancellation:', error);
    }
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

  async acceptOrder(orderId: string, courierId: string) {
    // 1. Ambil order untuk cek status awal
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');

    // Jika sudah ada kurir lain (Race Condition protection)
    if (order.courierId && order.courierId !== courierId) {
      throw new BadRequestException('Pesanan ini sudah diambil oleh kurir lain');
    }

    // --- LOGIC INSTANT -> ON_GOING ---
    const isInstant = order.scheduleType === 'INSTANT';
    const targetStatus = isInstant ? OrderStatus.ON_GOING : OrderStatus.MATCHED;
    const historyNote = isInstant 
      ? 'Kurir menyetujui pesanan (Instant) - Langsung berangkat' 
      : 'Kurir menyetujui pesanan';

    const result = await this.prisma.$transaction(async (tx) => {
      // 2. Atomic update: Hanya update jika courierId masih null atau memang milik kurir ini
      // Menggunakan updateMany untuk bisa memfilter berdasarkan courierId di level DB
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          OR: [
            { courierId: null },
            { courierId: courierId }
          ],
          status: { in: [OrderStatus.CREATED, OrderStatus.MATCHED] }
        },
        data: {
          courierId: courierId,
          status: targetStatus,
        },
      });

      if (updated.count === 0) {
        throw new BadRequestException('Gagal mengambil pesanan. Mungkin sudah diambil kurir lain atau status berubah.');
      }

      // 3. Catat history
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: targetStatus,
          note: historyNote,
        },
      });

      // Ambil data lengkap untuk dikembalikan
      return tx.order.findUnique({
        where: { id: orderId },
        include: {
          address: true,
          user: { select: { id: true, name: true, phone: true } },
          courier: { include: { user: { select: { id: true, name: true, phone: true } } } },
        },
      });
    });

    // Notify user bahwa kurir sudah ditemukan
    try {
      const notifBody = isInstant 
        ? 'Kurir telah menerima pesanan Anda dan sedang menuju lokasi Anda.' 
        : 'Kurir telah menerima pesanan Anda. Silakan tunggu kurir berangkat.';
        
      await this.notificationService.sendPushNotification({
        userId: order.userId,
        title: isInstant ? '🚛 Kurir Menuju Lokasi!' : '✅ Kurir Ditemukan!',
        body: notifBody,
        type: 'ORDER_UPDATE',
        data: { orderId, status: targetStatus },
      });
    } catch (error) {
      console.error('Failed to notify user about courier acceptance:', error);
    }

    return result;
  }

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

        // --- POINT SYSTEM: Award points based on MUTU weight ---
        const totalMutuWeight = order.wasteItems.reduce((acc, item) => acc + item.weight, 0);
        const earnedPoints = Math.floor(totalMutuWeight); // 1 kg = 1 point, no float

        if (earnedPoints > 0) {
          await tx.pointTransaction.create({
            data: {
              userId: order.userId,
              orderId: order.id,
              points: earnedPoints,
              mutuWeight: totalMutuWeight,
              description: `Point dari order #${order.id.slice(0, 8)} (${totalMutuWeight.toFixed(2)} kg MUTU)`,
            },
          });

          await tx.user.update({
            where: { id: order.userId },
            data: {
              totalPoints: { increment: earnedPoints },
            },
          });
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
        let body = notifContent.body;
        if (newStatus === OrderStatus.COMPLETED) {
          const totalMutuWeight = updatedOrder.wasteItems.reduce((acc, item) => acc + item.weight, 0);
          const earnedPoints = Math.floor(totalMutuWeight);
          if (earnedPoints > 0) {
            body = `Terima kasih! Sampah Anda telah berhasil diproses. Anda mendapatkan ${earnedPoints} poin. Saldo wallet Anda telah terupdate.`;
          }
        }

        await this.notificationService.sendPushNotification({
          userId: order.userId,
          title: notifContent.title,
          body,
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

    // Re-broadcast to eligible couriers
    this.broadcastToCouriers(orderId).catch(err =>
      console.error('Re-broadcast to couriers failed:', err),
    );

    return { message: 'Order rejected, broadcasting to other couriers' };
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

  // ==========================================
  // Step 1: Start Weighing — Auto-generate random weights
  // ==========================================
  async startWeighing(orderId: string, courierId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.courierId !== courierId) throw new BadRequestException('Order is not assigned to you');

    if (order.status !== OrderStatus.ARRIVED && order.status !== OrderStatus.WEIGHING) {
      throw new BadRequestException(`Cannot start weighing in ${order.status} status`);
    }

    // Generate random weights (simulasi timbangan digital)
    // const mutuWeight = Number((3 + Math.random() * 7).toFixed(2));     // 3-10 kg
    // const residualWeight = Number((1 + Math.random() * 3).toFixed(2)); // 1-4 kg
    const mutuWeight = 3;     // 3-10 kg
    const residualWeight = 7; // 1-4 kg

    // Simpan weights di StatusHistory note sebagai JSON (untuk dibaca di step 2)
    const weighingData = JSON.stringify({ mutuWeight, residualWeight });

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Cleanup data timbangan sebelumnya (jika ada re-weigh)
      await tx.orderWasteItem.deleteMany({ where: { orderId } });
      await tx.orderResidual.deleteMany({ where: { orderId } });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: OrderStatus.WEIGHING,
          note: weighingData,
        },
      });

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.WEIGHING,
          // Reset totals karena belum final
          totalCredit: null,
          totalDebit: null,
          netTotal: null,
        },
      });
    });

    return {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
      weighing: {
        mutuWeight,
        residualWeight,
        totalWeight: Number((mutuWeight + residualWeight).toFixed(2)),
      },
     
      message: 'Berat berhasil diukur. Pilih jenis sampah mutu dan upload foto, lalu tekan Submit.',
    };
  }

  // ==========================================
  // Step 2: Submit Weighing — Kurir pilih jenis mutu + upload foto
  // ==========================================
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

    if (order.status !== OrderStatus.WEIGHING) {
      throw new BadRequestException(`Cannot submit weighing in ${order.status} status. Harus start-weighing dulu.`);
    }

    // 1. Baca random weights dari StatusHistory (dari step 1)
    const weighingHistory = await this.prisma.orderStatusHistory.findFirst({
      where: { orderId, status: OrderStatus.WEIGHING },
      orderBy: { createdAt: 'desc' },
    });

    if (!weighingHistory || !weighingHistory.note) {
      throw new BadRequestException('Data timbangan tidak ditemukan. Silakan lakukan start-weighing terlebih dahulu.');
    }

    let mutuWeight: number;
    let residualWeight: number;
    try {
      const parsed = JSON.parse(weighingHistory.note);
      mutuWeight = parsed.mutuWeight;
      residualWeight = parsed.residualWeight;
    } catch {
      throw new BadRequestException('Data timbangan rusak. Silakan lakukan start-weighing ulang.');
    }

    // 2. Lookup jenis sampah mutu yang dipilih kurir
    const wasteType = await this.prisma.wasteType.findUnique({
      where: { id: data.wasteTypeId },
    });

    if (!wasteType) {
      throw new BadRequestException(`Jenis sampah mutu dengan ID ${data.wasteTypeId} tidak ditemukan`);
    }

    if (wasteType.category !== 'MUTU') {
      throw new BadRequestException(`Jenis sampah "${wasteType.name}" bukan kategori MUTU`);
    }

    // 3. Kalkulasi mutu
    const mutuSubtotal = mutuWeight * wasteType.unitPrice;
    const totalCredit = mutuSubtotal;

    // 4. Kalkulasi residu
    let totalDebit = 0;
    let residualData: any = null;

    if (residualWeight > 0) {
      const residuType = await this.prisma.wasteType.findFirst({
        where: { category: 'RESIDU' },
        orderBy: { createdAt: 'asc' },
      });

      if (!residuType) {
        throw new BadRequestException('Kategori sampah RESIDU belum dikonfigurasi di database.');
      }

      const residuSubtotal = residualWeight * residuType.unitPrice;
      totalDebit = residuSubtotal;
      residualData = {
        weight: residualWeight,
        pricePerKg: residuType.unitPrice,
        subtotal: residuSubtotal,
        photoUrl: photoUrl || null,
      };
    }

    const netTotal = totalCredit - totalDebit;
    // const nextStatus = netTotal < 0 ? OrderStatus.WAITING_PAYMENT : OrderStatus.PICKED_UP;
    const nextStatus = OrderStatus.WEIGHING; // Status tetap WEIGHING sampai user konfirmasi

    // 5. Simpan ke database + auto-transition
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Cleanup (in case re-submit)
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
            create: {
              wasteTypeId: wasteType.id,
              weight: mutuWeight,
              price: wasteType.unitPrice,
              subtotal: mutuSubtotal,
            },
          },
          residuals: residualData ? {
            create: residualData,
          } : undefined,
          statusHistory: {
            create: {
              status: nextStatus,
              note: `Kurir telah mensubmit hasil timbangan. Menunggu konfirmasi user.`,
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

    // 6. Notify User untuk konfirmasi timbangan
    try {
      await this.notificationService.sendPushNotification({
        userId: order.userId,
        title: '⚖️ Konfirmasi Timbangan',
        body: `Kurir telah selesai menimbang sampah Anda. Silakan cek rincian dan konfirmasi hasil timbangan.`,
        type: 'WEIGHING_SUBMITTED',
        data: { orderId, netTotal: String(netTotal), status: nextStatus },
      });
    } catch (error) {
      console.error('Failed to notify user after weighing submission:', error);
    }

    return updatedOrder;
  }

  async getWeighingSummary(orderId: string, userId: string, role: string) {
    const where: any = { id: orderId };

    if (role === Role.COURIER) {
      const courier = await this.prisma.courier.findFirst({ where: { userId } });
      if (courier) {
        where.courierId = courier.id;
      } else {
        where.userId = userId;
      }
    } else if (role !== Role.ADMIN) {
      where.userId = userId;
    }

    const order = await this.prisma.order.findFirst({
      where,
      include: {
        wasteItems: {
          include: { wasteType: true },
        },
        residuals: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        courier: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    // Validasi: belum ditimbang
    const preWeighingStatuses: OrderStatus[] = [
      OrderStatus.CREATED,
      OrderStatus.MATCHED,
      OrderStatus.ON_GOING,
      OrderStatus.ARRIVED,
    ];

    if (preWeighingStatuses.includes(order.status)) {
      throw new BadRequestException(
        'Data timbangan belum tersedia. Kurir belum menyelesaikan proses penimbangan.',
      );
    }

    // --- Kalkulasi Mutu Items ---
    const mutuItems = order.wasteItems.map((item) => ({
      id: item.id,
      wasteTypeName: item.wasteType.name,
      category: item.wasteType.category,
      weight: item.weight,
      pricePerKg: item.price,
      subtotal: item.subtotal,
    }));

    const totalMutuWeight = mutuItems.reduce((acc, i) => acc + i.weight, 0);
    const totalCredit = mutuItems.reduce((acc, i) => acc + i.subtotal, 0);

    // --- Kalkulasi Residuals ---
    const residuals = order.residuals.map((r) => ({
      id: r.id,
      weight: r.weight,
      pricePerKg: r.pricePerKg,
      subtotal: r.subtotal,
      photoUrl: r.photoUrl,
    }));

    const totalResidualWeight = residuals.reduce((acc, r) => acc + r.weight, 0);
    const totalDebit = residuals.reduce((acc, r) => acc + r.subtotal, 0);

    // --- Net Total ---
    const netTotal = totalCredit - totalDebit;
    const userReceives = netTotal >= 0 ? netTotal : 0;
    const userPays = netTotal < 0 ? Math.abs(netTotal) : 0;
    const paymentRequired = netTotal < 0;

    // --- Payment Info ---
    const latestPayment = order.payments.length > 0 ? order.payments[0] : null;
    const paymentInfo = latestPayment
      ? {
          id: latestPayment.id,
          method: latestPayment.method,
          amount: latestPayment.amount,
          status: latestPayment.status,
          invoiceUrl: latestPayment.invoiceUrl,
          paidAt: latestPayment.paidAt,
        }
      : null;

    // --- Formatter helper ---
    const formatRupiah = (amount: number) =>
      `Rp ${Math.abs(amount).toLocaleString('id-ID')}`;

    return {
      orderId: order.id,
      status: order.status,
      courier: order.courier
        ? {
            id: order.courier.id,
            name: order.courier.user.name,
            phone: order.courier.user.phone,
            vehicleType: order.courier.vehicleType,
          }
        : null,
      mutuItems,
      residuals,
      summary: {
        totalMutuWeight: Number(totalMutuWeight.toFixed(2)),
        totalResidualWeight: Number(totalResidualWeight.toFixed(2)),
        totalWeight: Number((totalMutuWeight + totalResidualWeight).toFixed(2)),
        totalCredit,
        totalDebit,
        netTotal,
        userReceives,
        userPays,
        formattedCredit: formatRupiah(totalCredit),
        formattedDebit: formatRupiah(totalDebit),
        formattedNetTotal: `${netTotal >= 0 ? '+' : '-'} ${formatRupiah(netTotal)}`,
        formattedUserReceives: formatRupiah(userReceives),
        formattedUserPays: formatRupiah(userPays),
        paymentRequired,
        paymentStatus: latestPayment?.status || null,
        estimatedPoints: Math.floor(totalMutuWeight),
      },
      payment: paymentInfo,
    };
  }


  async confirmWeighing(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new BadRequestException('Not your order');
    if (order.status !== OrderStatus.WEIGHING) {
      throw new BadRequestException(`Order is not in WEIGHING status (current: ${order.status})`);
    }

    if (order.netTotal === null) {
      throw new BadRequestException('Weighing data is not complete. Wait for courier to submit.');
    }

    const nextStatus = order.netTotal < 0 ? OrderStatus.WAITING_PAYMENT : OrderStatus.PICKED_UP;

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      return tx.order.update({
        where: { id: orderId },
        data: {
          status: nextStatus,
          statusHistory: {
            create: {
              status: nextStatus,
              note: nextStatus === OrderStatus.WAITING_PAYMENT 
                ? 'User menyetujui timbangan. Menunggu pembayaran residu.' 
                : 'User menyetujui timbangan. Sampah siap diangkut.',
            },
          },
        },
      });
    });

    // Notify Courier
    if (order.courierId) {
      try {
        const courier = await this.prisma.courier.findUnique({
          where: { id: order.courierId },
        });
        if (courier) {
          if (nextStatus === OrderStatus.WAITING_PAYMENT) {
            await this.notificationService.sendPushNotification({
              userId: courier.userId,
              title: '⚖️ Timbangan Disetujui',
              body: `User menyetujui hasil timbangan. Menunggu pembayaran residu oleh user.`,
              type: 'WEIGHING_CONFIRMED',
              data: { orderId: orderId, status: nextStatus },
            });
          } else {
            await this.notificationService.sendPushNotification({
              userId: courier.userId,
              title: '🚛 Lanjutkan Pengangkutan',
              body: `User menyetujui hasil timbangan. Silakan angkut sampah dan lanjutkan perjalanan.`,
              type: 'ORDER_UPDATE',
              data: { orderId: orderId, status: nextStatus },
            });
          }
        }
      } catch (error) {
        console.error('Failed to notify courier about weighing confirmation:', error);
      }
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
