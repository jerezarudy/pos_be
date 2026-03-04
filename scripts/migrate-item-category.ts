import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../src/app.module';

async function migrate() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) throw new Error('Missing database connection');

    const items = db.collection('items');
    const categories = db.collection('categories');

    const categoryDocs = await categories
      .find({}, { projection: { name: 1 } })
      .toArray();
    const categoryNameById = new Map<string, string>(
      categoryDocs
        .map((c: any) => [String(c?._id ?? ''), String(c?.name ?? '')] as const)
        .filter(([id, name]) => !!id && !!name),
    );

    const cursor = items.find(
      {
        categoryId: { $exists: true, $type: 'string' },
        category: { $exists: false },
      },
      { projection: { categoryId: 1 } },
    );

    let scanned = 0;
    let updated = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const doc = await cursor.next();
      if (!doc) break;
      scanned++;

      const categoryId = String((doc as any).categoryId ?? '').trim();
      if (!categoryId) continue;

      const name = categoryNameById.get(categoryId) || undefined;
      const res = await items.updateOne(
        { _id: (doc as any)._id },
        {
          $set: { category: { id: categoryId, ...(name ? { name } : {}) } },
          $unset: { categoryId: '' },
        },
      );

      if (res.modifiedCount) updated++;
    }

    console.log(JSON.stringify({ scanned, updated }, null, 2));
  } finally {
    await app.close();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
