import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get('GOOGLE_CLIENT_ID'),
    );
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOne(email);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    // Hash refresh token and save to DB
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.usersService.update(user.id, {
      refreshToken: hashedRefreshToken,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
    };
  }

  async register(data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const existingUser = await this.usersService.findOne(data.email);
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }
    const user = await this.usersService.create({
      ...data,
      password: hashedPassword,
    });

    return this.login(user);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.usersService.findOneById(payload.sub);

      if (!user || !user.refreshToken) {
        throw new UnauthorizedException();
      }

      const isRefreshTokenMatching = await bcrypt.compare(
        refreshToken,
        user.refreshToken,
      );

      if (!isRefreshTokenMatching) {
        throw new UnauthorizedException();
      }

      const newPayload = { email: user.email, sub: user.id, role: user.role };
      return {
        access_token: this.jwtService.sign(newPayload),
      };
    } catch (e) {
      throw new UnauthorizedException();
    }
  }

  async sendOtp(userId: string, email: string) {
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 mins expiry

    await this.usersService.update(userId, {
      otpCode,
          otpExpiresAt: expiresAt,
    });

    // MOCK SENDING (Log to console)
    console.log(`[OTP MOCK] Sending OTP ${otpCode} to ${email}`);

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(userId: string, code: string) {
    const user = await this.usersService.findOneById(userId);
    if (!user || user.otpCode !== code) {
      throw new BadRequestException('Invalid OTP code');
    }

    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
      throw new BadRequestException('OTP code expired');
    }

    await this.usersService.update(userId, {
      isVerified: true,
      otpCode: null,
      otpExpiresAt: null,
    });

    return { message: 'User verified successfully' };
  }

  async logout(userId: string) {
    await this.usersService.update(userId, {
      refreshToken: null,
    });
    return { message: 'Logged out successfully' };
  }

  async googleLogin(idToken: string) {
    if (!idToken) {
      throw new BadRequestException('ID Token tidak ditemukan dalam request');
    }
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: idToken,
        audience: this.configService.get('GOOGLE_CLIENT_ID'),
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new BadRequestException('Invalid Google token');
      }

      const { email, name, picture } = payload;

      let user = await this.usersService.findOne(email);

      if (!user) {
        // Create new user if not exists
        user = await this.usersService.create({
          email,
          name,
          password: await bcrypt.hash(Math.random().toString(36), 10), // Random password for google users
          isVerified: true, // Google emails are verified
          photoUrl: picture,
        });
      }

      return this.login(user);
    } catch (error) {
      console.error('Google Auth Detail Error:', error);
      throw new UnauthorizedException('Google authentication failed: ' + error.message);
    }
  }
}
