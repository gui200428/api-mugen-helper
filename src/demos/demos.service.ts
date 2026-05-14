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
const FRAMEWORK_BUILD_DIRS = [
    'dist',
    'build',
    'out',
    '.next',
    'public',
    'www',
    'output',
];

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
            throw new ConflictException(
                `Demo with slug "${dto.slug}" already exists`,
            );
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
            throw new BadRequestException(
                'Failed to extract ZIP file. The file may be corrupted.',
            );
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
                const isFrameworkDir = FRAMEWORK_BUILD_DIRS.includes(
                    singleItem.toLowerCase(),
                );
                const hasIndexInside = fs.existsSync(
                    path.join(singleItemPath, 'index.html'),
                );

                if (isFrameworkDir || hasIndexInside) {
                    this.logger.log(`Flattening build directory: ${singleItem}/ → root`);
                    const subContents = fs.readdirSync(singleItemPath);
                    for (const item of subContents) {
                        fs.renameSync(
                            path.join(singleItemPath, item),
                            path.join(demoDir, item),
                        );
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
                        fs.renameSync(
                            path.join(singlePath, item),
                            path.join(demoDir, item),
                        );
                    }
                    try {
                        fs.rmdirSync(singlePath);
                    } catch {
                        /* may not be empty */
                    }
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
        this.logger.log(
            `Demo status updated: ${updated.slug} is now ${isActive ? 'ACTIVE' : 'INACTIVE'}`,
        );
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

        // TELEMETRIA
        // Incrementa o contador de acessos de forma assíncrona (fire-and-forget)
        // Isso garante que a resposta HTTP não seja atrasada pelo banco de dados.
        this.prisma.demoPage.update({
            where: { id: demo.id },
            data: { accessCount: { increment: 1 } }
        }).catch(err => {
            this.logger.error(`Erro ao atualizar telemetria da demo ${slug}: ${err.message}`);
        });
        // FIM DA TELEMETRIA

        // <base> tag: resolve relative assets correctly via the API proxy path
        const baseTag = `<base href="/demos/serve/${slug}/">`;

        /**
         * Navigation interceptor script.
         *
         * The demo is accessed via https://mugentecnologia.com/demo/<slug>
         * (Vercel rewrites that to https://api.mugentecnologia.com/demos/serve/<slug>).
         *
         * Without this script, any absolute link inside the demo that points to the
         * client's real domain (e.g. https://temnao.com/) would take the user
         * completely outside mugentecnologia.com.
         *
         * This script intercepts every click on <a> tags and, when the destination
         * is an absolute URL whose origin differs from the page's own origin
         * (i.e. an external domain), rewrites it so the user stays inside the proxy:
         *   https://temnao.com/about  →  https://mugentecnologia.com/demo/<slug>/about
         *   https://temnao.com/       →  https://mugentecnologia.com/demo/<slug>/
         *
         * History-based navigation (pushState / replaceState) is also patched so
         * client-side routers keep working while remaining on the proxy origin.
         */
        const publicOrigin =
            process.env.PUBLIC_ORIGIN ?? 'https://mugentecnologia.com';
        const interceptorScript = `
<script data-mugen-proxy="1">
(function () {
  var PUBLIC_ORIGIN = ${JSON.stringify(publicOrigin)};
  var DEMO_BASE     = PUBLIC_ORIGIN + '/demo/${slug}';

  function rewrite(href) {
    if (!href) return href;
    try {
      var url = new URL(href, location.href);
      // Only rewrite links that leave the current proxy origin
      if (url.origin !== location.origin) {
        var tail = url.pathname + url.search + url.hash;
        // Strip leading slash so we don't end up with double slashes
        if (tail.startsWith('/')) tail = tail.slice(1);
        return DEMO_BASE + '/' + tail;
      }
    } catch (e) { /* relative or invalid URL — leave as-is */ }
    return href;
  }

  // Intercept <a> clicks
  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!target) return;
    var href = target.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
    var rewritten = rewrite(href);
    if (rewritten !== href) {
      e.preventDefault();
      location.href = rewritten;
    }
  }, true);

  // Patch history API so SPA client-side navigation also stays in proxy
  ['pushState', 'replaceState'].forEach(function (method) {
    var orig = history[method];
    history[method] = function (state, title, url) {
      if (url) {
        try {
          var u = new URL(url, location.href);
          if (u.origin !== location.origin) {
            var tail = u.pathname + u.search + u.hash;
            if (tail.startsWith('/')) tail = tail.slice(1);
            url = DEMO_BASE + '/' + tail;
          }
        } catch (e) {}
      }
      return orig.call(this, state, title, url);
    };
  });
})();
</script>`;

        // Case-insensitive injection into <head>
        html = html.replace(
            /<head(\s[^>]*)?>/i,
            (match) => `${match}\n  ${baseTag}\n  ${interceptorScript}`,
        );

        // Fallback if no <head> tag exists
        if (!html.includes(baseTag)) {
            html = `${baseTag}\n${interceptorScript}\n${html}`;
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
        const demo = await this.prisma.demoPage.findUnique({
            where: { id: demoId },
        });

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
            this.logger.error(
                `Failed to clean up demo files at ${dirPath}: ${error.message}`,
            );
        }
    }
}
