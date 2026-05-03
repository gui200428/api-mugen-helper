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
  Header,
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DemosService } from './demos.service';
import { CreateDemoDto } from './dto/create-demo.dto';
import { AdminGuard } from '../admin-auth/guards/admin.guard';
import * as path from 'path';
import * as mime from 'mime-types';

@Controller('demos')
export class DemosController {
  constructor(private readonly demosService: DemosService) { }

  // Admin: upload a new demo
  @Post()
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
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

  // Admin: update demo status (active/inactive)
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

  // Public: serve a demo page
  @Get('serve/:slug')
  async serve(@Param('slug') slug: string, @Res() res: Response) {
    try {
      const html = await this.demosService.serve(slug);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      // If demo is expired/inactive, redirect to the root of the client's original website
      try {
        const demo = await this.demosService.findBySlug(slug);
        if (demo && demo.client && demo.client.website) {
          let website = demo.client.website.trim();
          if (!website.startsWith('http')) {
            website = `https://${website}`;
          }
          const urlObj = new URL(website);
          const rootUrl = `${urlObj.protocol}//${urlObj.host}`;
          return res.redirect(rootUrl);
        }
      } catch (e) {
        // If demo doesn't exist at all, fall through
      }

      const frontendUrl = process.env.CORS_ORIGIN 
        ? process.env.CORS_ORIGIN.split(',')[0].trim() 
        : 'http://localhost:3001';
      return res.redirect(frontendUrl);
    }
  }

  // Public: serve demo assets (CSS, JS, images, etc.)
  @Get('serve/:slug/*assetPath')
  async serveAsset(
    @Param('slug') slug: string,
    @Param('assetPath') assetPath: string | string[],
    @Res() res: Response,
  ) {
    // NestJS/path-to-regexp v3 returns an array for wildcard matches
    let resolvedAssetPath = Array.isArray(assetPath) ? assetPath.join('/') : assetPath;
    if (!resolvedAssetPath && res.req.params[0]) {
      resolvedAssetPath = res.req.params[0];
    }

    const fullPath = await this.demosService.getAssetPath(slug, resolvedAssetPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = mime.lookup(ext) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(fullPath);
  }
}
