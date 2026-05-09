import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, dto: CreateNoteDto) {
    return this.prisma.note.create({
      data: {
        ...dto,
        adminId,
      },
      include: {
        admin: {
          select: {
            name: true,
          }
        }
      }
    });
  }

  async findAll(folderId?: string) {
    const where = folderId ? { folderId } : { folderId: null };
    return this.prisma.note.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        admin: {
          select: {
            name: true,
          }
        }
      }
    });
  }

  async findOne(id: string) {
    const note = await this.prisma.note.findUnique({
      where: { id },
      include: {
        admin: {
          select: {
            name: true,
          }
        }
      }
    });
    if (!note) {
      throw new NotFoundException('Anotação não encontrada');
    }
    return note;
  }

  async update(id: string, dto: UpdateNoteDto) {
    const note = await this.prisma.note.findUnique({ where: { id } });
    if (!note) {
      throw new NotFoundException('Anotação não encontrada');
    }
    return this.prisma.note.update({
      where: { id },
      data: dto,
      include: {
        admin: {
          select: {
            name: true,
          }
        }
      }
    });
  }

  async remove(id: string) {
    const note = await this.prisma.note.findUnique({ where: { id } });
    if (!note) {
      throw new NotFoundException('Anotação não encontrada');
    }
    return this.prisma.note.delete({ where: { id } });
  }
}
