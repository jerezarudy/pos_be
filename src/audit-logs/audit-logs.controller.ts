import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLogsService } from './audit-logs.service';

@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get('items/stock')
  findItemStockChanges(@Query() query: any) {
    return this.auditLogsService.findItemStockChanges(query);
  }

  @Get('items/deleted')
  findDeletedItems(@Query() query: any) {
    return this.auditLogsService.findDeletedItems(query);
  }
}
