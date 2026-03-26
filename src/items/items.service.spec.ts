import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';

describe('ItemsService', () => {
  let service: ItemsService;
  let itemModel: any;
  let itemImagesCloudinaryService: any;

  beforeEach(() => {
    itemModel = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };
    itemImagesCloudinaryService = {
      deleteItemImage: jest.fn(),
    };

    service = new ItemsService(
      itemModel,
      { findById: jest.fn() } as any,
      itemImagesCloudinaryService,
    );
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
      imagePublicId: 'pos-rodmar/items/cola',
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
        imagePublicId: 'pos-rodmar/items/cola',
        category: { id: 'cat-1', name: 'Drinks' },
      }),
    );
    expect(result).toEqual({ _id: 'item-1' });
  });

  it('deletes the previous Cloudinary image when an item image is replaced', async () => {
    itemModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'item-1',
        trackStock: true,
        inStock: 5,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/old.png',
        imagePublicId: 'pos-rodmar/items/old',
      }),
    });
    itemModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'item-1',
        trackStock: true,
        inStock: 5,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/new.png',
        imagePublicId: 'pos-rodmar/items/new',
      }),
    });

    await service.update('item-1', {
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/new.png',
      imagePublicId: 'pos-rodmar/items/new',
    });

    expect(itemImagesCloudinaryService.deleteItemImage).toHaveBeenCalledWith(
      'pos-rodmar/items/old',
    );
  });

  it('deletes the Cloudinary image when an item is removed', async () => {
    itemModel.findByIdAndDelete.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'item-1',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/cola.png',
        imagePublicId: 'pos-rodmar/items/cola',
      }),
    });

    await expect(service.remove('item-1')).resolves.toEqual({
      deleted: true,
      id: 'item-1',
    });

    expect(itemImagesCloudinaryService.deleteItemImage).toHaveBeenCalledWith(
      'pos-rodmar/items/cola',
    );
  });
});
