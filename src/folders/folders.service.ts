import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, dto: CreateFolderDto) {
    if (dto.parentId) {
      const parentFolder = await this.prisma.folder.findUnique({
        where: { id: dto.parentId },
      });
      if (!parentFolder)
        throw new BadRequestException('Pasta pai não encontrada');
    }
    return this.prisma.folder.create({
      data: {
        ...dto,
        adminId,
      },
    });
  }

  async findAll() {
    return this.prisma.folder.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { notes: true, children: true },
        },
      },
    });
  }

  async getFolderTree() {
    const folders = await this.findAll();
    const folderMap = new Map<string, any>();

    // Convert to simple tree
    const roots: any[] = [];

    folders.forEach((f) => {
      folderMap.set(f.id, { ...f, childrenFolders: [] });
    });

    folders.forEach((f) => {
      if (f.parentId) {
        const parent = folderMap.get(f.parentId);
        if (parent) {
          parent.childrenFolders.push(folderMap.get(f.id));
        } else {
          roots.push(folderMap.get(f.id)); // fallback if parent missing
        }
      } else {
        roots.push(folderMap.get(f.id));
      }
    });

    return roots;
  }

  async findOne(id: string) {
    const folder = await this.prisma.folder.findUnique({
      where: { id },
      include: {
        children: {
          include: {
            _count: {
              select: { notes: true, children: true },
            },
          },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: {
            admin: { select: { name: true } },
          },
        },
      },
    });
    if (!folder) {
      throw new NotFoundException('Pasta não encontrada');
    }
    return folder;
  }

  async update(id: string, dto: UpdateFolderDto) {
    const folder = await this.prisma.folder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Pasta não encontrada');

    if (dto.parentId) {
      if (dto.parentId === id)
        throw new BadRequestException(
          'Uma pasta não pode ser filha dela mesma',
        );
      const parentFolder = await this.prisma.folder.findUnique({
        where: { id: dto.parentId },
      });
      if (!parentFolder)
        throw new BadRequestException('Pasta pai não encontrada');
    }

    return this.prisma.folder.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const folder = await this.prisma.folder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Pasta não encontrada');
    return this.prisma.folder.delete({ where: { id } });
  }
}
