import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import { AppModule } from '../src/app.module';

const ITEM_CRUD_PATH_REGEX = /^\/items(?:\/[^/?]+)?(?:\?.*)?$/;
const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

function firstTrimmedString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed && trimmed !== '[object Object]') return trimmed;
  }
  return undefined;
}

function readNestedName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return firstTrimmedString(
    record.itemName,
    record.resourceName,
    record.name,
    readNestedName(record.body),
  );
}

async function backfill() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) throw new Error('Missing database connection');

    const auditLogs = db.collection('audit_logs');
    const items = db.collection('items');

    const cursor = auditLogs.find({
      method: { $in: ['POST', 'PATCH', 'PUT', 'DELETE'] },
      path: ITEM_CRUD_PATH_REGEX,
      $or: [
        { itemName: { $exists: false } },
        { itemName: null },
        { itemName: '' },
        { itemId: { $exists: false } },
        { itemId: null },
        { itemId: '' },
        { itemId: '[object Object]' },
      ],
    });

    let scanned = 0;
    let updated = 0;
    let unrecoverable = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const log = await cursor.next();
      if (!log) break;
      scanned++;

      const itemId = firstTrimmedString(
        (log as any).itemId,
        (log as any).resourceId,
        (log as any).params?.id,
      );
      const itemName = readNestedName(log);

      let item: any;
      if (itemId && OBJECT_ID_REGEX.test(itemId)) {
        item = await items.findOne(
          { _id: Types.ObjectId.createFromHexString(itemId) },
          { projection: { name: 1, storeId: 1 } },
        );
      }

      const set: Record<string, unknown> = {};
      if (itemId) {
        set.itemId = itemId;
        set.resourceId = itemId;
      }
      if (itemName || item?.name) {
        set.itemName = itemName ?? item.name;
        set.resourceName = itemName ?? item.name;
      }
      if (!(log as any).storeId && item?.storeId) {
        set.storeId = String(item.storeId);
      }

      if (Object.keys(set).length === 0) {
        unrecoverable++;
        continue;
      }

      const result = await auditLogs.updateOne(
        { _id: (log as any)._id },
        { $set: set },
      );
      if (result.modifiedCount) updated++;
    }

    console.log(JSON.stringify({ scanned, updated, unrecoverable }, null, 2));
  } finally {
    await app.close();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
