import { UserRole } from '../user-role.enum';

export class UpdateUserDto {
  name?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
  password?: string;
  pos_pin?: string;
  storeId?: string;
  assignedStoreId?: string;
}
