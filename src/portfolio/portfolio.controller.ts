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
import { PortfolioService } from './portfolio.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import { AdminGuard } from '../admin-auth/guards/admin.guard';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  // Admin: upload a new portfolio page (500MB max)
  @Post()
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  create(
    @Body() dto: CreatePortfolioDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.portfolioService.create(dto, file);
  }

  // Admin: list all portfolio pages
  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.portfolioService.findAll();
  }

  // Admin: toggle active status
  @Patch(':id/status')
  @UseGuards(AdminGuard)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.portfolioService.updateStatus(id, isActive);
  }

  // Admin: delete a portfolio page
  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.portfolioService.remove(id);
  }

  /**
   * Public: serve a portfolio page's index.html with the injected <base> tag.
   * Static assets (CSS, JS, images) are handled by express.static in main.ts.
   */
  @Get(['serve/:slug', 'serve/:slug/*'])
  async serve(@Param('slug') slug: string, @Res() res: Response) {
    try {
      const html = await this.portfolioService.serve(slug);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
          "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
          "style-src * 'unsafe-inline'",
          "img-src * data: blob:",
          "font-src * data:",
          "connect-src *",
          "frame-src *",
          "worker-src * blob:",
          "manifest-src *",
        ].join('; '),
      );
      res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
      res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.removeHeader('X-Frame-Options');

      res.send(html);
    } catch (error) {
      res.removeHeader('X-Frame-Options');
      const frontendUrl = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')[0].trim()
        : 'http://localhost:3001';
      return res.redirect(frontendUrl);
    }
  }
}
