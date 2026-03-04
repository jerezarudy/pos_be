import type { Schema } from 'mongoose';
import { getRequestActor } from './request-context';

export function createdUpdatedByPlugin(schema: Schema) {
  if (!schema.path('createdBy')) {
    schema.add({
      createdBy: { type: String, trim: true, index: true },
    });
  }
  if (!schema.path('updatedBy')) {
    schema.add({
      updatedBy: { type: String, trim: true, index: true },
    });
  }

  schema.pre('save', function (next) {
    const actor = getRequestActor();
    if (this.isNew) this.createdBy = actor;
    this.updatedBy = actor;
    next();
  });

  const setUpdatedBy = function (next: any) {
    const actor = getRequestActor();
    const update: any = this.getUpdate?.() ?? {};

    // Support both standard update objects and aggregation pipeline updates.
    if (Array.isArray(update)) {
      update.push({
        $set: {
          updatedBy: actor,
          createdBy: { $ifNull: ['$createdBy', actor] },
        },
      });
      this.setUpdate(update);
      next();
      return;
    }

    if (update.$set) update.$set.updatedBy = actor;
    else update.$set = { updatedBy: actor };

    if (update.updatedBy !== undefined) delete update.updatedBy;

    if (!update.$setOnInsert) update.$setOnInsert = {};
    if (update.$setOnInsert.createdBy === undefined) {
      update.$setOnInsert.createdBy = actor;
    }

    this.setUpdate(update);
    next();
  };

  schema.pre('findOneAndUpdate', setUpdatedBy);
  schema.pre('updateOne', setUpdatedBy);
  schema.pre('updateMany', setUpdatedBy);
}
