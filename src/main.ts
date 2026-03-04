import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { NextFunction, Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on port ${port}`);
}
bootstrap();
