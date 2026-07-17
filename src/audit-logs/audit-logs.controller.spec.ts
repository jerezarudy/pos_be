import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsController', () => {
  let controller: AuditLogsController;
  const auditLogsService = {
    findItemStockChanges: jest.fn(),
    findDeletedItems: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
      ],
    }).compile();

    controller = module.get<AuditLogsController>(AuditLogsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates stock audit log lookups to the service', () => {
    const query = { page: '2', itemId: 'item-1' };

    controller.findItemStockChanges(query);

    expect(auditLogsService.findItemStockChanges).toHaveBeenCalledWith(query);
  });

  it('delegates deleted item audit log lookups to the service', () => {
    const query = { page: '1', userId: 'user-1' };

    controller.findDeletedItems(query);

    expect(auditLogsService.findDeletedItems).toHaveBeenCalledWith(query);
  });
});
