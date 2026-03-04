import { DiscountType } from '../discount-type.enum';

export class UpdateDiscountDto {
  name?: string;
  type?: DiscountType;
  value?: number;
  restrictedAccess?: boolean;
}
