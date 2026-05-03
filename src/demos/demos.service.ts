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

@Injectable()
export class DemosService {
  private readonly logger = new Logger(DemosService.name);

  constructor(private readonly prisma: PrismaService) {
    // Ensure uploads directory exists
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      this.logger.log(`Created uploads directory: ${UPLOADS_DIR}`);
    }
  }

  async create(dto: CreateDemoDto, file: Express.Multer.File) {
    // Validate client exists
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
    });

    if (!client) {
      throw new NotFoundException(`Client with id "${dto.clientId}" not found`);
    }

    // Check slug uniqueness
    const existingDemo = await this.prisma.demoPage.findUnique({
      where: { slug: dto.slug },
    });

    if (existingDemo) {
      throw new ConflictException(`Demo with slug "${dto.slug}" already exists`);
    }

    // Validate the uploaded file
    if (!file) {
      throw new BadRequestException('A ZIP file is required');
    }

    if (!file.originalname.endsWith('.zip')) {
      throw new BadRequestException('Only .zip files are accepted');
    }

    // Extract ZIP to uploads/demos/{slug}/
    const demoDir = path.join(UPLOADS_DIR, dto.slug);

    try {
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();

      // Security: validate entries before extraction
      const hasIndex = entries.some((entry) => {
        const name = entry.entryName.toLowerCase();
        return name === 'index.html' || name.endsWith('/index.html');
      });

      if (!hasIndex) {
        throw new BadRequestException(
          'ZIP must contain an index.html file at the root or in a subdirectory',
        );
      }

      // Security: prevent path traversal
      for (const entry of entries) {
        const resolved = path.resolve(demoDir, entry.entryName);
        if (!resolved.startsWith(path.resolve(demoDir))) {
          throw new BadRequestException(
            'ZIP contains files with invalid paths (path traversal detected)',
          );
        }
      }

      // Create directory and extract
      fs.mkdirSync(demoDir, { recursive: true });
      zip.extractAllTo(demoDir, true);

      // If index.html is inside a subdirectory, move everything up
      const topLevelDirs = fs.readdirSync(demoDir);
      if (
        topLevelDirs.length === 1 &&
        fs.statSync(path.join(demoDir, topLevelDirs[0])).isDirectory()
      ) {
        const subDir = path.join(demoDir, topLevelDirs[0]);
        const subContents = fs.readdirSync(subDir);
        for (const item of subContents) {
          fs.renameSync(path.join(subDir, item), path.join(demoDir, item));
        }
        fs.rmdirSync(subDir);
      }

      // Verify index.html exists at root after extraction
      if (!fs.existsSync(path.join(demoDir, 'index.html'))) {
        this.cleanupDemoFiles(demoDir);
        throw new BadRequestException(
          'After extraction, index.html was not found at the root level',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.cleanupDemoFiles(demoDir);
      this.logger.error(`Failed to extract ZIP: ${error.message}`);
      throw new BadRequestException('Failed to extract ZIP file');
    }

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEMO_EXPIRY_DAYS);

    // Create database record
    const demo = await this.prisma.demoPage.create({
      data: {
        slug: dto.slug,
        clientId: dto.clientId,
        filePath: demoDir,
        expiresAt,
      },
      include: { client: true },
    });

    // Client status is no longer overwritten when a demo is created

    this.logger.log(
      `Demo created: ${dto.slug} for client ${client.name} (expires: ${expiresAt.toISOString()})`,
    );

    return demo;
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
    // If activating, extend the expiration date to avoid immediate expiration
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

  async serve(slug: string): Promise<string> {
    const demo = await this.prisma.demoPage.findUnique({
      where: { slug },
    });

    if (!demo || !demo.isActive) {
      throw new NotFoundException('Demo not found or has expired');
    }

    // Check if expired
    if (demo.expiresAt < new Date()) {
      await this.expireDemo(demo.id);
      throw new NotFoundException('Demo has expired');
    }

    const indexPath = path.join(demo.filePath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      throw new NotFoundException('Demo files not found on server');
    }

    let html = fs.readFileSync(indexPath, 'utf-8');
    
    // Inject <base> tag right after <head> to fix relative asset loading
    const baseTag = `<base href="/demos/serve/${slug}/">`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n  ${baseTag}`);
    } else {
      // Fallback if there's no head tag
      html = `${baseTag}\n${html}`;
    }

    return html;
  }

  async getAssetPath(slug: string, assetPath: string): Promise<string> {
    const demo = await this.prisma.demoPage.findUnique({
      where: { slug },
    });

    if (!demo || !demo.isActive) {
      throw new NotFoundException('Demo not found or has expired');
    }

    if (demo.expiresAt < new Date()) {
      await this.expireDemo(demo.id);
      throw new NotFoundException('Demo has expired');
    }

    // Security: prevent path traversal
    const fullPath = path.resolve(demo.filePath, assetPath);
    if (!fullPath.startsWith(path.resolve(demo.filePath))) {
      throw new BadRequestException('Invalid asset path');
    }

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Asset not found: ${fullPath} (from: ${assetPath})`);
    }

    return fullPath;
  }

  async remove(id: string) {
    const demo = await this.prisma.demoPage.findUnique({
      where: { id },
    });

    if (!demo) {
      throw new NotFoundException(`Demo with id "${id}" not found`);
    }

    // Delete files from filesystem
    this.cleanupDemoFiles(demo.filePath);

    // Delete database record
    await this.prisma.demoPage.delete({ where: { id } });

    this.logger.log(`Demo deleted: ${demo.slug} (${id})`);
    return { message: 'Demo deleted successfully' };
  }

  // Cron: runs every hour to expire old demos
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

    if (expiredDemos.length === 0) {
      return;
    }

    this.logger.log(`Expiring ${expiredDemos.length} demo(s)...`);

    for (const demo of expiredDemos) {
      await this.expireDemo(demo.id);
    }

    this.logger.log(`Expired ${expiredDemos.length} demo(s) successfully`);
  }

  private async expireDemo(demoId: string) {
    const demo = await this.prisma.demoPage.findUnique({
      where: { id: demoId },
    });

    if (!demo) return;

    // Mark as inactive
    await this.prisma.demoPage.update({
      where: { id: demoId },
      data: { isActive: false },
    });

    // Client CRM status is no longer updated when demo expires

    // Clean up files
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
