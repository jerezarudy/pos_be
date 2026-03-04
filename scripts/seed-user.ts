import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/users/user-role.enum';
import { UsersService } from '../src/users/users.service';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const usersService = app.get(UsersService);
    const created = await usersService.create({
      email: 'test@email.com',
      password: 'test123',
      name: 'Test User',
      role: UserRole.Admin,
    });
    // passwordHash is not included by default
    console.log(
      JSON.stringify(
        {
          id: created._id,
          email: created.email,
          role: created.role,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

