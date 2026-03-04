export class CreateItemDto {
  name!: string;
  categoryId?: string;
  category?: { id?: string; name?: string };
  sku?: number | string;
  barcode?: string;
  price?: number;
  cost?: number;
  description?: string;
  trackStock?: boolean;
  inStock?: number;
}
