export class UpdateItemDto {
  storeId?: string;
  name?: string;
  categoryId?: string;
  category?: { id?: string; name?: string };
  sku?: number | string;
  barcode?: string;
  price?: number;
  description?: string;
  imageUrl?: string;
  trackStock?: boolean;
  inStock?: number;
}
