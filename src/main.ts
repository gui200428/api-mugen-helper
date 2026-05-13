import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import type { Request, Response, NextFunction } from 'express';

const DEMOS_DIR = path.join(process.cwd(), 'uploads', 'demos');
const PAGES_DIR = path.join(process.cwd(), 'uploads', 'pages');

/**
 * Permissive security headers for user-uploaded sites.
 * Allows CDN scripts (Cloudflare, GA, unpkg, etc.), external fonts, and cross-origin APIs.
 */
function setServeHeaders(res: Response) {
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
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const logger = new Logger('Bootstrap');
  const expressApp = app.getHttpAdapter().getInstance() as express.Application;

  // ─── Static file serving for demos ────────────────────────────────────────
  // Mounted BEFORE NestJS routes so Express handles asset requests directly.
  // Each demo's files live at uploads/demos/<slug>/ and are served under
  // /demos/serve/<slug>/*. The NestJS controller only handles the root index.html.
  if (!fs.existsSync(DEMOS_DIR)) fs.mkdirSync(DEMOS_DIR, { recursive: true });
  if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR, { recursive: true });

  expressApp.use(
    '/demos/serve',
    (req: Request, res: Response, next: NextFunction) => {
      // Extract slug from URL: /demos/serve/<slug>/...rest...
      const parts = req.path.split('/').filter(Boolean);
      if (parts.length < 2) return next(); // let NestJS handle /demos/serve/<slug> (index.html)

      const slug = parts[0];
      const slugDir = path.join(DEMOS_DIR, slug);

      if (!fs.existsSync(slugDir)) return next();

      setServeHeaders(res);

      // Re-map request path: strip the slug prefix so express.static resolves correctly
      const assetPath = '/' + parts.slice(1).join('/');
      const originalUrl = req.url;
      req.url = assetPath;

      express.static(slugDir, {
        index: false, // NestJS controller serves index.html with injected <base> tag
        maxAge: req.path.match(
          /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|webp)$/,
        )
          ? '1y'
          : 0,
      })(req, res, (err) => {
        req.url = originalUrl; // restore for NestJS fallback
        next(err);
      });
    },
  );

  // ─── Static file serving for portfolio pages ───────────────────────────────
  expressApp.use(
    '/portfolio/serve',
    (req: Request, res: Response, next: NextFunction) => {
      const parts = req.path.split('/').filter(Boolean);
      if (parts.length < 2) return next();

      const slug = parts[0];
      const slugDir = path.join(PAGES_DIR, slug);

      if (!fs.existsSync(slugDir)) return next();

      setServeHeaders(res);

      const assetPath = '/' + parts.slice(1).join('/');
      const originalUrl = req.url;
      req.url = assetPath;

      express.static(slugDir, {
        index: false,
        maxAge: req.path.match(
          /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|webp)$/,
        )
          ? '1y'
          : 0,
      })(req, res, (err) => {
        req.url = originalUrl;
        next(err);
      });
    },
  );

  // ─── Helmet: skip serve routes (they set their own headers above) ──────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.path.startsWith('/demos/serve/') ||
      req.path.startsWith('/portfolio/serve/')
    ) {
      return next();
    }
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          objectSrc: ["'none'"],
          frameAncestors: ['*'],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })(req, res, next);
  });

  // ─── CORS ─────────────────────────────────────────────────────────────────
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:3001'];

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}
bootstrap();
