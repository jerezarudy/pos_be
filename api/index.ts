import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';

let cachedServer: ReturnType<typeof express> | undefined;
let cachedInit: Promise<unknown> | undefined;

async function init() {
  if (cachedServer && cachedInit) {
    await cachedInit;
    return cachedServer;
  }

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  app.enableCors({ origin: true });

  cachedServer = server;
  cachedInit = app.init();
  await cachedInit;

  return server;
}

export default async function handler(req: any, res: any) {
  const server = await init();
  return server(req, res);
}
