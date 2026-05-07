import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import AdmZip from 'adm-zip';
import * as path from 'path';
import * as fs from 'fs';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'pages');

const FRAMEWORK_BUILD_DIRS = ['dist', 'build', 'out', '.next', 'public', 'www', 'output'];

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      this.logger.log(`Created portfolio uploads directory: ${UPLOADS_DIR}`);
    }
  }

  async create(dto: CreatePortfolioDto, file: Express.Multer.File) {
    const existing = await this.prisma.portfolioPage.findUnique({
      where: { slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(`Portfolio page with slug "${dto.slug}" already exists`);
    }

    if (!file) {
      throw new BadRequestException('A ZIP file is required');
    }

    if (!file.originalname.endsWith('.zip')) {
      throw new BadRequestException('Only .zip files are accepted');
    }

    const pageDir = path.join(UPLOADS_DIR, dto.slug);

    try {
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();

      const hasIndex = entries.some((entry) => {
        const name = entry.entryName.toLowerCase();
        return name === 'index.html' || name.endsWith('/index.html');
      });

      if (!hasIndex) {
        throw new BadRequestException(
          'ZIP must contain an index.html file at the root or in a subdirectory',
        );
      }

      for (const entry of entries) {
        const resolved = path.resolve(pageDir, entry.entryName);
        if (!resolved.startsWith(path.resolve(pageDir))) {
          throw new BadRequestException(
            'ZIP contains files with invalid paths (path traversal detected)',
          );
        }
      }

      fs.mkdirSync(pageDir, { recursive: true });
      zip.extractAllTo(pageDir, true);

      this.flattenBuildDirectory(pageDir);

      if (!fs.existsSync(path.join(pageDir, 'index.html'))) {
        this.cleanupFiles(pageDir);
        throw new BadRequestException(
          'After extraction, index.html was not found at the root level',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.cleanupFiles(pageDir);
      this.logger.error(`Failed to extract ZIP: ${error.message}`);
      throw new BadRequestException('Failed to extract ZIP file');
    }

    const page = await this.prisma.portfolioPage.create({
      data: {
        slug: dto.slug,
        title: dto.title,
        filePath: pageDir,
      },
    });

    this.logger.log(`Portfolio page created: ${dto.slug} (title: ${dto.title})`);
    return page;
  }

  async findAll() {
    return this.prisma.portfolioPage.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBySlug(slug: string) {
    const page = await this.prisma.portfolioPage.findUnique({
      where: { slug },
    });

    if (!page) {
      throw new NotFoundException(`Portfolio page "${slug}" not found`);
    }

    return page;
  }

  async updateStatus(id: string, isActive: boolean) {
    const page = await this.prisma.portfolioPage.findUnique({ where: { id } });
    if (!page) {
      throw new NotFoundException(`Portfolio page with id "${id}" not found`);
    }

    const updated = await this.prisma.portfolioPage.update({
      where: { id },
      data: { isActive },
    });

    this.logger.log(`Portfolio page status updated: ${updated.slug} → ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
    return updated;
  }

  async remove(id: string) {
    const page = await this.prisma.portfolioPage.findUnique({ where: { id } });

    if (!page) {
      throw new NotFoundException(`Portfolio page with id "${id}" not found`);
    }

    this.cleanupFiles(page.filePath);
    await this.prisma.portfolioPage.delete({ where: { id } });

    this.logger.log(`Portfolio page deleted: ${page.slug} (${id})`);
    return { message: 'Portfolio page deleted successfully' };
  }

  async serve(slug: string): Promise<{ html: string }> {
    const page = await this.prisma.portfolioPage.findUnique({ where: { slug } });

    if (!page || !page.isActive) {
      throw new NotFoundException('Portfolio page not found or is inactive');
    }

    const indexPath = path.join(page.filePath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      throw new NotFoundException('Portfolio page files not found on server');
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Inject <base> tag (case-insensitive match for <head> / <Head> / <HEAD>)
    const baseTag = `<base href="/portfolio/serve/${slug}/">`;
    html = html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n  ${baseTag}`);
    if (!html.includes(baseTag)) {
      html = `${baseTag}\n${html}`;
    }

    return { html };
  }

  private flattenBuildDirectory(dir: string) {
    const items = fs.readdirSync(dir);

    if (items.length === 1) {
      const singlePath = path.join(dir, items[0]);
      if (fs.statSync(singlePath).isDirectory()) {
        const isFramework = FRAMEWORK_BUILD_DIRS.includes(items[0].toLowerCase());
        const hasIndex = fs.existsSync(path.join(singlePath, 'index.html'));

        if (isFramework || hasIndex) {
          this.logger.log(`Flattening build directory: ${items[0]}/ → root`);
          const sub = fs.readdirSync(singlePath);
          for (const f of sub) {
            fs.renameSync(path.join(singlePath, f), path.join(dir, f));
          }
          fs.rmdirSync(singlePath);
        }
      }
    }

    // Second pass: if still no index.html, try flattening the only remaining dir
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 1) {
        const p = path.join(dir, remaining[0]);
        if (fs.statSync(p).isDirectory()) {
          const sub = fs.readdirSync(p);
          for (const f of sub) {
            fs.renameSync(path.join(p, f), path.join(dir, f));
          }
          try { fs.rmdirSync(p); } catch { /* ignore */ }
        }
      }
    }
  }

  private cleanupFiles(dirPath: string) {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        this.logger.log(`Cleaned up portfolio files: ${dirPath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to clean up portfolio files at ${dirPath}: ${error.message}`);
    }
  }
}
