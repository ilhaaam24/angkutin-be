import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const url = this.configService.get('SUPABASE_URL');
    // Gunakan SERVICE_ROLE_KEY agar bisa bypass RLS di server-side
    const key = this.configService.get('SUPABASE_SERVICE_ROLE_KEY') || this.configService.get('SUPABASE_ANON_KEY');

    if (!url || !key) {
      console.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Upload might fail.');
    }

    this.supabase = createClient(url || '', key || '', {
      auth: {
        persistSession: false,
      },
    });
  }

  /**
   * Mengompres gambar agar di bawah 1MB dan resize untuk efisiensi
   */
  async compressImage(file: Buffer): Promise<Buffer> {
    try {
      return await sharp(file)
        .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 }) // Kompresi kualitas
        .toBuffer();
    } catch (error) {
      throw new BadRequestException('Gagal memproses gambar: ' + error.message);
    }
  }

  /**
   * Upload file ke Supabase Storage
   * @param file Buffer file mentah
   * @param folder Folder tujuan dalam bucket
   * @param bucket Nama bucket (default: profile_pic)
   */
  async uploadImage(
    file: Buffer,
    folder: string = 'profiles',
    bucket: string = 'profile_pic',
  ): Promise<string> {
    // 1. Kompres gambar
    const compressedBuffer = await this.compressImage(file);

    // 2. Cek ukuran (max 1MB)
    if (compressedBuffer.length > 1024 * 1024) {
      // Jika masih > 1MB, turunkan kualitas lagi
      const finalBuffer = await sharp(compressedBuffer)
        .jpeg({ quality: 60 })
        .toBuffer();
      return this.executeUpload(finalBuffer, folder, bucket);
    }

    return this.executeUpload(compressedBuffer, folder, bucket);
  }

  private async executeUpload(
    buffer: Buffer,
    folder: string,
    bucket: string,
  ): Promise<string> {
    const fileName = `${folder}/${uuidv4()}.jpg`;

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      throw new BadRequestException('Gagal upload ke storage: ' + error.message);
    }

    const { data: publicUrl } = this.supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return publicUrl.publicUrl;
  }
}
