import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmailForLogin(email);
    if (!user?.passwordHash)
      throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const payload = {
      sub: String(user._id),
      email: user.email,
      role: user.role,
      storeId: (user as any)?.storeId ?? (user as any)?.assignedStoreId,
    };

    const access_token = await this.jwtService.signAsync(payload);

    return {
      access_token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        storeId: (user as any)?.storeId ?? (user as any)?.assignedStoreId,
      },
    };
  }
}
