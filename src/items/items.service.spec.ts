import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';

describe('ItemsService', () => {
  let service: ItemsService;
  let itemModel: any;
  let itemTransferModel: any;
  let itemImagesCloudinaryService: any;

  beforeEach(() => {
    itemModel = {
      create: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      db: {
        db: {
          admin: jest.fn().mockReturnValue({
            command: jest.fn().mockResolvedValue({}),
          }),
        },
      },
    };
    itemTransferModel = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };
    itemImagesCloudinaryService = {
      deleteItemImage: jest.fn(),
    };

    service = new ItemsService(
      itemModel,
      { findById: jest.fn() } as any,
      itemTransferModel,
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

  it('transfers stock to an existing item in another store', async () => {
    const source = {
      _id: 'source-item',
      storeId: 'store-1',
      name: 'Cola',
      sku: 100001,
      trackStock: true,
      inStock: 10,
      toObject: jest.fn().mockReturnValue({
        _id: 'source-item',
        storeId: 'store-1',
        name: 'Cola',
        sku: 100001,
        trackStock: true,
        inStock: 10,
      }),
    };
    const destination = {
      _id: 'destination-item',
      storeId: 'store-2',
      name: 'Cola',
      sku: 100001,
      trackStock: true,
      inStock: 5,
    };
    const updatedDestination = { ...destination, inStock: 8 };

    itemModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(source),
    });
    itemModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(destination),
    });
    itemModel.findByIdAndUpdate
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(updatedDestination),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({ ...source, inStock: 7 }),
      });
    itemTransferModel.create.mockResolvedValue([
      {
        _id: 'transfer-1',
        sourceItemId: 'source-item',
        destinationItemId: 'destination-item',
        amount: 3,
      },
    ]);

    const result = await service.transfer('source-item', {
      toStoreId: 'store-2',
      amount: 3,
    });

    expect(itemModel.findOne).toHaveBeenCalledWith({
      storeId: 'store-2',
      sku: 100001,
    });
    expect(itemModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'destination-item',
      {
        trackStock: true,
        $inc: { inStock: 3 },
      },
      { new: true, session: undefined },
    );
    expect(itemModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'source-item',
      { inStock: 7 },
      { new: true, session: undefined },
    );
    expect(itemTransferModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          fromStoreId: 'store-1',
          toStoreId: 'store-2',
          sourceItemId: 'source-item',
          destinationItemId: 'destination-item',
          amount: 3,
          sourceBeforeStock: 10,
          sourceAfterStock: 7,
          destinationBeforeStock: 5,
          destinationAfterStock: 8,
          destinationItemCreated: false,
          sourceItemDeleted: false,
        }),
      ],
      { session: undefined },
    );
    expect(result.destinationItem).toBe(updatedDestination);
  });

  it('returns transfer reports with store and user lookup enrichment', async () => {
    itemTransferModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          data: [
            {
              _id: 'transfer-1',
              fromStoreId: 'store-1',
              toStoreId: 'store-2',
              itemName: 'Cola',
              amount: 3,
              fromStore: { _id: 'store-1', name: 'Main' },
              toStore: { _id: 'store-2', name: 'Branch' },
              user: { _id: 'user-1', name: 'Admin' },
            },
          ],
          total: [{ count: 1 }],
        },
      ]),
    });

    const result = await service.findTransferReports({
      from: '2026-05-01',
      to: '2026-05-28',
      originStoreId: 'store-1',
      destinationStoreId: 'store-2',
    });

    expect(itemTransferModel.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          $match: expect.objectContaining({
            $and: expect.arrayContaining([
              { fromStoreId: 'store-1' },
              { toStoreId: 'store-2' },
            ]),
          }),
        },
      ]),
    );
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        fromStore: { _id: 'store-1', name: 'Main' },
        toStore: { _id: 'store-2', name: 'Branch' },
        user: { _id: 'user-1', name: 'Admin' },
      }),
    );
    expect(result.total).toBe(1);
  });
});
