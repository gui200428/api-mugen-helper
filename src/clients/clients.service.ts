import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientStatus, Prisma } from '@prisma/client';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClientDto, adminId?: string) {
    const client = await this.prisma.client.create({
      data: {
        ...dto,
        adminId,
      },
      include: {
        demoPages: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    });

    this.logger.log(`Client created: ${client.name} (${client.id})`);
    return client;
  }

  async findAll(params?: {
    page?: number;
    limit?: number;
    status?: ClientStatus;
    search?: string;
  }) {
    const page = params?.page ?? 1;
    const limit = Math.min(params?.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.ClientWhereInput = {};

    if (params?.status) {
      where.status = params.status;
    }

    if (params?.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { website: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { ownerName: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          demoPages: {
            select: { id: true, slug: true, isActive: true, expiresAt: true },
          },
          admin: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.client.count({ where }),
    ]);

    return {
      data: clients,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        demoPages: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    });

    if (!client) {
      throw new NotFoundException(`Client with id "${id}" not found`);
    }

    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    const existingClient = await this.findOne(id);

    // Restore or deactivate demo based on status change
    if (dto.status && dto.status !== existingClient.status) {
      if (dto.status === 'DEMO_ACTIVE') {
        // Restore the most recent demo
        const latestDemo = await this.prisma.demoPage.findFirst({
          where: { clientId: id },
          orderBy: { createdAt: 'desc' },
        });
        if (latestDemo) {
          // Extend expiration slightly to avoid instant expiration upon restore
          const newExpiry = new Date();
          newExpiry.setDate(newExpiry.getDate() + 7);

          await this.prisma.demoPage.update({
            where: { id: latestDemo.id },
            data: { isActive: true, expiresAt: newExpiry },
          });
        }
      } else if (existingClient.status === 'DEMO_ACTIVE') {
        // Deactivate active demos (pause them)
        await this.prisma.demoPage.updateMany({
          where: { clientId: id, isActive: true },
          data: { isActive: false },
        });
      }
    }

    const client = await this.prisma.client.update({
      where: { id },
      data: dto,
      include: {
        demoPages: {
          select: { id: true, slug: true, isActive: true, expiresAt: true },
        },
        admin: { select: { id: true, name: true, email: true } },
      },
    });

    this.logger.log(`Client updated: ${client.name} (${client.id})`);
    return client;
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.client.delete({ where: { id } });
    this.logger.log(`Client deleted: ${id}`);

    return { message: 'Client deleted successfully' };
  }
}
