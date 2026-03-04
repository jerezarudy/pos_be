import { DiscountType } from '../discount-type.enum';

export class CreateDiscountDto {
  name!: string;
  type!: DiscountType;
  value?: number;
  restrictedAccess?: boolean;
}
