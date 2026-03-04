export class CreateStoreDto {
  ownerId!: string;
  name!: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  description?: string;
}
