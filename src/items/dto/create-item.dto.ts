export class CreateItemDto {
  storeId?: string;
  name!: string;
  categoryId?: string;
  category?: { id?: string; name?: string };
  sku?: number | string;
  barcode?: string;
  price?: number;
  cost?: number;
  description?: string;
  imageUrl?: string;
  imagePublicId?: string;
  trackStock?: boolean;
  inStock?: number;
}
