import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DemosService } from './demos.service';
import { CreateDemoDto } from './dto/create-demo.dto';
import { AdminGuard } from '../admin-auth/guards/admin.guard';

@Controller('demos')
export class DemosController {
  constructor(private readonly demosService: DemosService) {}

  // Admin: upload a new demo (500MB max to support full framework builds)
  @Post()
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  create(
    @Body() dto: CreateDemoDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.demosService.create(dto, file);
  }

  // Admin: list all demos
  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.demosService.findAll();
  }

  // Admin: update demo status
  @Patch(':id/status')
  @UseGuards(AdminGuard)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.demosService.updateStatus(id, isActive);
  }

  // Admin: delete a demo
  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.demosService.remove(id);
  }

  /**
   * Public: serve a demo's index.html with the injected <base> tag.
   * All other static assets (CSS, JS, images, fonts) are served by the
   * express.static middleware registered in main.ts before NestJS routes.
   *
   * This endpoint also acts as the SPA fallback — any request reaching here
   * that isn't a real file will return the index.html so client-side routers
   * (React Router, Vue Router) can take over navigation.
   */
  @Get(['serve/:slug', 'serve/:slug/*'])
  async serve(@Param('slug') slug: string, @Res() res: Response) {
    try {
      const { html } = await this.demosService.serve(slug);

      // Permissive headers so external scripts (Cloudflare Insights, GA, unpkg, etc.)
      // load without being blocked by CSP.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
          "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
          "style-src * 'unsafe-inline'",
          'img-src * data: blob:',
          'font-src * data:',
          'connect-src *',
          'frame-src *',
          'worker-src * blob:',
          'manifest-src *',
        ].join('; '),
      );
      res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
      res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.removeHeader('X-Frame-Options');

      res.send(html);
    } catch (error) {
      res.removeHeader('X-Frame-Options');
      // Demo expired/inactive → redirect to client's website or app homepage
      try {
        const demo = await this.demosService.findBySlug(slug);
        if (demo && demo.client && demo.client.website) {
          let website = demo.client.website.trim();
          if (!website.startsWith('http')) website = `https://${website}`;
          const urlObj = new URL(website);
          return res.redirect(`${urlObj.protocol}//${urlObj.host}`);
        }
      } catch (e) {
        /* demo doesn't exist */
      }

      const frontendUrl = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')[0].trim()
        : 'http://localhost:3001';
      return res.redirect(frontendUrl);
    }
  }
}
