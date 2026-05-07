import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDemoDto } from './dto/create-demo.dto';
import AdmZip from 'adm-zip';
import * as path from 'path';
import * as fs from 'fs';

const DEMO_EXPIRY_DAYS = 7;
const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'demos');

// Common framework build output directories that should be flattened to root
const FRAMEWORK_BUILD_DIRS = ['dist', 'build', 'out', '.next', 'public', 'www', 'output'];

@Injectable()
export class DemosService {
  private readonly logger = new Logger(DemosService.name);

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      this.logger.log(`Created uploads directory: ${UPLOADS_DIR}`);
    }
  }

  async create(dto: CreateDemoDto, file: Express.Multer.File) {
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
    });

    if (!client) {
      throw new NotFoundException(`Client with id "${dto.clientId}" not found`);
    }

    const existingDemo = await this.prisma.demoPage.findUnique({
      where: { slug: dto.slug },
    });

    if (existingDemo) {
      throw new ConflictException(`Demo with slug "${dto.slug}" already exists`);
    }

    if (!file) {
      throw new BadRequestException('A ZIP file is required');
    }

    if (!file.originalname.endsWith('.zip')) {
      throw new BadRequestException('Only .zip files are accepted');
    }

    const demoDir = path.join(UPLOADS_DIR, dto.slug);

    try {
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();

      // Security: prevent path traversal
      for (const entry of entries) {
        const resolved = path.resolve(demoDir, entry.entryName);
        if (!resolved.startsWith(path.resolve(demoDir))) {
          throw new BadRequestException(
            'ZIP contains files with invalid paths (path traversal detected)',
          );
        }
      }

      // Detect if index.html exists anywhere in the ZIP
      const hasIndex = entries.some((entry) => {
        const name = entry.entryName.toLowerCase();
        return name === 'index.html' || name.endsWith('/index.html');
      });

      if (!hasIndex) {
        throw new BadRequestException(
          'ZIP must contain an index.html file. For React/Vite builds, run "npm run build" first and zip the dist/ folder.',
        );
      }

      // Create directory and extract
      fs.mkdirSync(demoDir, { recursive: true });
      zip.extractAllTo(demoDir, true);

      // Flatten common framework build output directories to root
      this.flattenBuildDirectory(demoDir);

      // Verify index.html exists at root after extraction/flattening
      if (!fs.existsSync(path.join(demoDir, 'index.html'))) {
        this.cleanupDemoFiles(demoDir);
        throw new BadRequestException(
          'After extraction, index.html was not found at the root level. ' +
          'Make sure to zip the contents of your build output (dist/, build/, out/) directly.',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.cleanupDemoFiles(demoDir);
      this.logger.error(`Failed to extract ZIP: ${error.message}`);
      throw new BadRequestException('Failed to extract ZIP file. The file may be corrupted.');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEMO_EXPIRY_DAYS);

    const demo = await this.prisma.demoPage.create({
      data: {
        slug: dto.slug,
        clientId: dto.clientId,
        filePath: demoDir,
        expiresAt,
      },
      include: { client: true },
    });

    this.logger.log(
      `Demo created: ${dto.slug} for client ${client.name} (expires: ${expiresAt.toISOString()})`,
    );

    return demo;
  }

  /**
   * Flattens framework build output directories to the demo root.
   * Handles cases like: zip containing a single "dist/" or "build/" folder.
   */
  private flattenBuildDirectory(demoDir: string) {
    const topLevelItems = fs.readdirSync(demoDir);

    // Case 1: Single directory at root that is a known framework build output
    if (topLevelItems.length === 1) {
      const singleItem = topLevelItems[0];
      const singleItemPath = path.join(demoDir, singleItem);

      if (fs.statSync(singleItemPath).isDirectory()) {
        // Check if it's a known build output dir or contains index.html
        const isFrameworkDir = FRAMEWORK_BUILD_DIRS.includes(singleItem.toLowerCase());
        const hasIndexInside = fs.existsSync(path.join(singleItemPath, 'index.html'));

        if (isFrameworkDir || hasIndexInside) {
          this.logger.log(`Flattening build directory: ${singleItem}/ → root`);
          const subContents = fs.readdirSync(singleItemPath);
          for (const item of subContents) {
            fs.renameSync(path.join(singleItemPath, item), path.join(demoDir, item));
          }
          fs.rmdirSync(singleItemPath);
        }
      }
    }

    // Case 2: Root has a single non-build directory but index.html is inside
    // (e.g. zip was created from a parent folder)
    if (!fs.existsSync(path.join(demoDir, 'index.html'))) {
      const items = fs.readdirSync(demoDir);
      if (items.length === 1) {
        const singlePath = path.join(demoDir, items[0]);
        if (fs.statSync(singlePath).isDirectory()) {
          const subContents = fs.readdirSync(singlePath);
          for (const item of subContents) {
            fs.renameSync(path.join(singlePath, item), path.join(demoDir, item));
          }
          try { fs.rmdirSync(singlePath); } catch { /* may not be empty */ }
        }
      }
    }
  }

  async findAll() {
    return this.prisma.demoPage.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        client: {
          select: { id: true, name: true, email: true, website: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    const demo = await this.prisma.demoPage.findUnique({
      where: { slug },
      include: { client: true },
    });

    if (!demo) {
      throw new NotFoundException(`Demo "${slug}" not found`);
    }

    return demo;
  }

  async updateStatus(id: string, isActive: boolean) {
    const demo = await this.prisma.demoPage.findUnique({ where: { id } });
    if (!demo) {
      throw new NotFoundException(`Demo with id "${id}" not found`);
    }

    const data: any = { isActive };
    if (isActive) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + DEMO_EXPIRY_DAYS);
      data.expiresAt = expiresAt;
    }

    const updated = await this.prisma.demoPage.update({
      where: { id },
      data,
    });
    this.logger.log(`Demo status updated: ${updated.slug} is now ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
    return updated;
  }

  async serve(slug: string): Promise<{ html: string }> {
    const demo = await this.prisma.demoPage.findUnique({ where: { slug } });

    if (!demo || !demo.isActive) {
      throw new NotFoundException('Demo not found or has expired');
    }

    if (demo.expiresAt < new Date()) {
      await this.expireDemo(demo.id);
      throw new NotFoundException('Demo has expired');
    }

    const indexPath = path.join(demo.filePath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      throw new NotFoundException('Demo files not found on server');
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Inject <base> tag to ensure relative assets resolve correctly
    const baseTag = `<base href="/demos/serve/${slug}/">`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n  ${baseTag}`);
    } else if (html.includes('<Head>')) {
      html = html.replace('<Head>', `<Head>\n  ${baseTag}`);
    } else {
      html = `${baseTag}\n${html}`;
    }

    return { html };
  }


  async remove(id: string) {
    const demo = await this.prisma.demoPage.findUnique({ where: { id } });

    if (!demo) {
      throw new NotFoundException(`Demo with id "${id}" not found`);
    }

    this.cleanupDemoFiles(demo.filePath);
    await this.prisma.demoPage.delete({ where: { id } });

    this.logger.log(`Demo deleted: ${demo.slug} (${id})`);
    return { message: 'Demo deleted successfully' };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleDemoExpiration() {
    const now = new Date();

    const expiredDemos = await this.prisma.demoPage.findMany({
      where: {
        isActive: true,
        expiresAt: { lt: now },
      },
      include: { client: true },
    });

    if (expiredDemos.length === 0) return;

    this.logger.log(`Expiring ${expiredDemos.length} demo(s)...`);

    for (const demo of expiredDemos) {
      await this.expireDemo(demo.id);
    }

    this.logger.log(`Expired ${expiredDemos.length} demo(s) successfully`);
  }

  private async expireDemo(demoId: string) {
    const demo = await this.prisma.demoPage.findUnique({ where: { id: demoId } });

    if (!demo) return;

    await this.prisma.demoPage.update({
      where: { id: demoId },
      data: { isActive: false },
    });

    this.cleanupDemoFiles(demo.filePath);
    this.logger.log(`Demo expired: ${demo.slug}`);
  }

  private cleanupDemoFiles(dirPath: string) {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        this.logger.log(`Cleaned up demo files: ${dirPath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to clean up demo files at ${dirPath}: ${error.message}`);
    }
  }
}
