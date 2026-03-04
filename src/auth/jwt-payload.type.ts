import { UserRole } from '../users/user-role.enum';

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
  storeId?: string;
};
