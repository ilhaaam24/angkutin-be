import { Injectable, OnModuleInit, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private firebaseApp: admin.app.App;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    
    if (!serviceAccountPath) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH not found in .env. Push notifications will not be sent.');
      return;
    }

    const fullPath = path.resolve(process.cwd(), serviceAccountPath);

    if (!fs.existsSync(fullPath)) {
      this.logger.error(`Firebase Service Account file not found at: ${fullPath}`);
      return;
    }

    try {
      const serviceAccount = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.logger.log('Firebase Admin SDK initialized successfully.');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error.stack);
    }
  }

  async sendPushNotification(params: {
    userId: string;
    title: string;
    body: string;
    type?: string;
    data?: Record<string, string>;
  }) {
    const { userId, title, body, type, data } = params;

    // 1. Simpan ke Database (In-App Notification)
    const dbNotification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        body,
        type,
      },
    });

    // 2. Ambil FCM Token user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    // 3. Kirim via FCM jika token tersedia dan firebase sudah inisialisasi
    if (user?.fcmToken && this.firebaseApp) {
      try {
        await this.firebaseApp.messaging().send({
          token: user.fcmToken,
          notification: {
            title,
            body,
          },
          data: {
            ...data,
            notificationId: dbNotification.id,
            type: type || 'GENERAL',
          },
        });
        this.logger.log(`Push notification sent successfully to user ${userId}`);
      } catch (error) {
        this.logger.error(`Failed to send push notification to user ${userId}`, error.stack);
      }
    } else {
      if (!user?.fcmToken) {
        this.logger.warn(`User ${userId} does not have an FCM token. Only in-app notification saved.`);
      }
    }

    return dbNotification;
  }

  async sendToMultipleUsers(params: {
    userIds: string[];
    title: string;
    body: string;
    type?: string;
    data?: Record<string, string>;
  }) {
    const results: any[] = [];
    for (const userId of params.userIds) {
      results.push(await this.sendPushNotification({ ...params, userId }));
    }
    return results;
  }

  async getUserNotifications(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async updateFcmToken(userId: string, fcmToken: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
    });
  }
}
