import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';

describe('ItemsService', () => {
  let service: ItemsService;
  let itemModel: any;

  beforeEach(() => {
    itemModel = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };

    service = new ItemsService(itemModel, {} as any);
  });

  it('updates stock and enables tracking for an item', async () => {
    const updatedItem = {
      _id: 'item-1',
      trackStock: true,
      inStock: 25,
    };

    itemModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'item-1', trackStock: false }),
    });
    itemModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updatedItem),
    });

    const result = await service.updateStock('item-1', { inStock: 25 });

    expect(itemModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'item-1',
      { trackStock: true, inStock: 25 },
      { new: true },
    );
    expect(result).toBe(updatedItem);
  });

  it('rejects missing stock values', async () => {
    await expect(
      service.updateStock('item-1', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when the item does not exist', async () => {
    itemModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.updateStock('item-1', { inStock: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('normalizes multipart item input when creating an item', async () => {
    itemModel.create.mockResolvedValue({ _id: 'item-1' });

    const result = await service.create({
      storeId: 'store-1',
      name: 'Cola',
      sku: '100001' as any,
      price: '12.5' as any,
      cost: '7.5' as any,
      trackStock: 'true' as any,
      inStock: '8' as any,
      imageUrl: '/uploads/items/cola.png',
      category: JSON.stringify({ id: 'cat-1', name: 'Drinks' }) as any,
    });

    expect(itemModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        name: 'Cola',
        sku: 100001,
        price: 12.5,
        cost: 7.5,
        trackStock: true,
        inStock: 8,
        imageUrl: '/uploads/items/cola.png',
        category: { id: 'cat-1', name: 'Drinks' },
      }),
    );
    expect(result).toEqual({ _id: 'item-1' });
  });
});
