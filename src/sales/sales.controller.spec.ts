import { Test, TestingModule } from '@nestjs/testing';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

describe('SalesController', () => {
  let controller: SalesController;
  const salesService = {
    create: jest.fn(),
    refund: jest.fn(),
    findAll: jest.fn(),
    reportByItem: jest.fn(),
    reportByCategory: jest.fn(),
    reportByEmployee: jest.fn(),
    reportByPaymentType: jest.fn(),
    reportReceipts: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        {
          provide: SalesService,
          useValue: salesService,
        },
      ],
    }).compile();

    controller = module.get<SalesController>(SalesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates refunds using the request store scope', () => {
    const req = {
      user: {
        storeId: 'store-1',
        role: 'cashier',
      },
    };
    const dto = { reason: 'Customer returned the item' };

    controller.refund(req, {}, 'sale-1', dto);

    expect(salesService.refund).toHaveBeenCalledWith(
      'sale-1',
      dto,
      req.user,
      'store-1',
    );
  });

  it('lists refunds using the request store scope', () => {
    const req = {
      user: {
        storeId: 'store-1',
        role: 'cashier',
      },
    };
    const query = { page: '2', q: 'RCPT' };

    controller.findRefunds(req, query);

    expect(salesService.findAll).toHaveBeenCalledWith(
      { ...query, type: 'refund' },
      'store-1',
    );
  });
});
