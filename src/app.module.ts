import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { UsersModule } from './users/users.module';
import { StoresModule } from './stores/stores.module';
import { CategoriesModule } from './categories/categories.module';
import { DiscountsModule } from './discounts/discounts.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uri =
          configService.get<string>('MONGODB_URI') ||
          configService.get<string>('MONGODB_URL') ||
          configService.get<string>('DATABASE_URL');
        if (!uri) {
          throw new Error(
            'Missing MongoDB connection string. Set MONGODB_URI (or MONGODB_URL / DATABASE_URL) in the environment',
          );
        }
        return {
          uri,
          dbName: 'pos_db',
        };
      },
    }),
    AuthModule,
    ItemsModule,
    UsersModule,
    StoresModule,
    CategoriesModule,
    DiscountsModule,
    AuditLogsModule,
    CustomersModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
