export class CreateCustomerDto {
  name!: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
  isActive?: boolean;
}

