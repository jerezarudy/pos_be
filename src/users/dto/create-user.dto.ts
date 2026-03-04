import { UserRole } from '../user-role.enum';

export class CreateUserDto {
  name?: string;
  email!: string;
  password!: string;
  role?: UserRole;
  isActive?: boolean;
  pos_pin?: string;
  storeId?: string;
  assignedStoreId?: string;
}
