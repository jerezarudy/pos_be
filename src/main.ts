import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { NextFunction, Request, Response } from 'express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Log each incoming HTTP request (method + URL) plus status and duration.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startMs = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startMs;
      console.log(
        `[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`,
      );
    });
    next();
  });

  // Enable CORS for all origins.
  app.enableCors({ origin: true });
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on port ${port}`);
}
bootstrap();
