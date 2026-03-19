import { Test, TestingModule } from '@nestjs/testing';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

describe('ItemsController', () => {
  let controller: ItemsController;
  const itemsService = {
    create: jest.fn(),
    update: jest.fn(),
    updateStock: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ItemsController],
      providers: [
        {
          provide: ItemsService,
          useValue: itemsService,
        },
      ],
    }).compile();

    controller = module.get<ItemsController>(ItemsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates stock updates to the service', () => {
    const dto = { inStock: 25 };

    controller.updateStock('item-1', dto);

    expect(itemsService.updateStock).toHaveBeenCalledWith('item-1', dto);
  });

  it('passes the uploaded item image url during create', () => {
    const dto = { name: 'Cola', storeId: 'store-1' };

    controller.create(dto as any, { filename: 'cola.png' });

    expect(itemsService.create).toHaveBeenCalledWith({
      ...dto,
      imageUrl: '/uploads/items/cola.png',
    });
  });

  it('passes the uploaded item image url during update', () => {
    const dto = { name: 'Cola Zero' };

    controller.update('item-1', dto as any, { filename: 'cola-zero.png' });

    expect(itemsService.update).toHaveBeenCalledWith('item-1', {
      ...dto,
      imageUrl: '/uploads/items/cola-zero.png',
    });
  });
});
