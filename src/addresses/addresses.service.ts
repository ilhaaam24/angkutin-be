import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Address, Prisma } from '../generated/prisma';

export type AddressResponse = Omit<Address, 'latitude' | 'longitude'>;

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  private excludeCoordinates(address: Address): AddressResponse {
    const { latitude, longitude, ...rest } = address;
    return rest;
  }

  async findAll(userId: string): Promise<AddressResponse[]> {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
    });
    return addresses.map(this.excludeCoordinates);
  }

  async findOne(id: string, userId: string): Promise<AddressResponse | null> {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
    });
    return address ? this.excludeCoordinates(address) : null;
  }

  private async getCoordinates(addressText: string): Promise<{ latitude: number, longitude: number }> {
    const apiKey = process.env.GEOCODING_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('GEOCODING_API_KEY is not set');
    }
    const url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(addressText)}?key=${apiKey}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data && data.results && data.results.length > 0) {
        const location = data.results[0].location;
        return {
          latitude: location.latitude,
          longitude: location.longitude,
        };
      }
    } catch (e) {
      console.error('Geocoding error:', e);
    }
    throw new BadRequestException('Alamat tidak dapat ditemukan titik koordinatnya oleh Google Maps');
  }

  async create(userId: string, data: Omit<Prisma.AddressCreateInput, 'user' | 'latitude' | 'longitude'>): Promise<AddressResponse> {
    if (data.isPrimary) {
      await this.unsetPrimary(userId);
    }

    const addressText = `${data.village}, ${data.district}, ${data.city}, ${data.province}, ${data.addressDetail}`;
    const coords = await this.getCoordinates(addressText);

    const address = await this.prisma.address.create({
      data: {
        ...data,
        latitude: coords.latitude,
        longitude: coords.longitude,
        user: { connect: { id: userId } },
      },
    });

    return this.excludeCoordinates(address);
  }

  async update(id: string, userId: string, data: Omit<Prisma.AddressUpdateInput, 'latitude' | 'longitude'>): Promise<AddressResponse> {
    if (data.isPrimary) {
      await this.unsetPrimary(userId);
    }

    let updateData: Prisma.AddressUpdateInput = { ...data };

    if (data.province || data.city || data.district || data.village || data.addressDetail) {
      const current = await this.prisma.address.findFirst({ where: { id, userId } });
      if (current) {
        const province = data.province ?? current.province;
        const city = data.city ?? current.city;
        const district = data.district ?? current.district;
        const village = data.village ?? current.village;
        const addressDetail = data.addressDetail ?? current.addressDetail;

        const addressText = `${village}, ${district}, ${city}, ${province}, ${addressDetail}`;
        const coords = await this.getCoordinates(addressText);
        updateData.latitude = coords.latitude;
        updateData.longitude = coords.longitude;
      }
    }

    const address = await this.prisma.address.update({
      where: { id, userId },
      data: updateData,
    });

    return this.excludeCoordinates(address);
  }

  async remove(id: string, userId: string): Promise<AddressResponse> {
    const address = await this.prisma.address.delete({
      where: { id, userId },
    });
    return this.excludeCoordinates(address);
  }

  private async unsetPrimary(userId: string) {
    await this.prisma.address.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
}
