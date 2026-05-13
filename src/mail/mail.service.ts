import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    const host = this.configService.get('SMTP_HOST', 'smtp.gmail.com');
    const port = Number(this.configService.get('SMTP_PORT', 587));
    const user = this.configService.get('SMTP_USER');

    console.log(`[MAIL CONFIG] Initializing with ${host}:${port} as ${user}`);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // Use secure for 465, false for 587
      auth: {
        user,
        pass: this.configService.get('SMTP_PASS'),
      },
    });

    // Verify connection on startup
    this.transporter.verify((error, success) => {
      if (error) {
        console.error('[MAIL CONFIG ERROR]', error);
      } else {
        console.log('[MAIL SERVER READY]');
      }
    });
  }

  async sendResetPasswordEmail(to: string, name: string, resetLink: string) {
    console.log(`[MAIL] Attempting to send email to ${to}...`);
const html = `
<div style="
  font-family: Roboto, Arial, sans-serif;
  background: #f7f9f8;
  padding: 40px 16px;
">
  <div style="
    max-width: 560px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid #E5E7EB;
  ">

    <!-- Header -->
    <div style="
      background: linear-gradient(135deg, #146B4E, #297A3F);
      padding: 40px 32px;
      text-align: center;
    ">
      <div style="
        width: 64px;
        height: 64px;
        margin: 0 auto 16px;
        background: rgba(255,255,255,0.15);
        border-radius: 16px;
        line-height: 64px;
        font-size: 30px;
      ">
        🔒
      </div>

      <h1 style="
        color: #ffffff;
        margin: 0;
        font-size: 28px;
        font-weight: 700;
      ">
        Reset Password
      </h1>

      <p style="
        color: #D5E4BD;
        margin-top: 10px;
        font-size: 14px;
      ">
        Permintaan reset password akun Angkutin
      </p>
    </div>

    <!-- Content -->
    <div style="padding: 36px 32px;">

      <p style="
        color: #111827;
        font-size: 16px;
        margin-top: 0;
      ">
        Halo <strong>${name || 'Pengguna'}</strong>,
      </p>

      <p style="
        color: #4B5563;
        font-size: 15px;
        line-height: 1.8;
        margin-bottom: 28px;
      ">
        Kami menerima permintaan untuk mengatur ulang password akun Anda.
        Klik tombol di bawah ini untuk membuat password baru dengan aman.
      </p>

      <!-- Button -->
      <div style="text-align: center; margin: 36px 0;">
        <a
          href="${resetLink}"
          style="
            display: inline-block;
            background: linear-gradient(135deg, #146B4E, #297A3F);
            color: #ffffff;
            text-decoration: none;
            padding: 14px 36px;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 600;
          "
        >
          Reset Password
        </a>
      </div>

      <!-- Info Box -->
      <div style="
        background: #F3F8F4;
        border: 1px solid #D5E4BD;
        border-radius: 12px;
        padding: 16px;
        margin-top: 24px;
      ">
        <p style="
          margin: 0;
          color: #4B5563;
          font-size: 13px;
          line-height: 1.7;
        ">
          Demi keamanan akun Anda, link ini hanya berlaku selama
          <strong>30 menit</strong>.
          Jika Anda tidak merasa meminta reset password, Anda dapat mengabaikan email ini.
        </p>
      </div>

      <!-- Divider -->
      <div style="
        height: 1px;
        background: #E5E7EB;
        margin: 32px 0 24px;
      "></div>

      <!-- Fallback Link -->
      <p style="
        color: #9CA3AF;
        font-size: 12px;
        line-height: 1.7;
        text-align: center;
        margin-bottom: 8px;
      ">
        Jika tombol tidak berfungsi, salin link berikut ke browser:
      </p>

      <p style="
        text-align: center;
        margin: 0;
      ">
        <a
          href="${resetLink}"
          style="
            color: #146B4E;
            font-size: 12px;
            word-break: break-all;
            text-decoration: none;
          "
        >
          ${resetLink}
        </a>
      </p>

    </div>

    <!-- Footer -->
    <div style="
      background: #F9FAFB;
      padding: 20px;
      text-align: center;
      border-top: 1px solid #E5E7EB;
    ">
      <p style="
        margin: 0;
        color: #9CA3AF;
        font-size: 12px;
      ">
        © ${new Date().getFullYear()} Angkutin. All rights reserved.
      </p>
    </div>

  </div>
</div>
`;

    try {
      const info = await this.transporter.sendMail({
        from: `"Angkutin" <${this.configService.get('SMTP_USER', 'noreply@angkutin.com')}>`,
        to,
        subject: 'Reset Password - Angkutin',
        html,
      });
      console.log(`[MAIL SUCCESS] Message sent: ${info.messageId}`);
      return info;
    } catch (error) {
      console.error('[MAIL SEND ERROR]', error);
      throw error;
    }
  }
}
