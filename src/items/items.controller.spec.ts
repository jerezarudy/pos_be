import { Test, TestingModule } from '@nestjs/testing';
import { ItemsController } from './items.controller';
import { ItemImagesCloudinaryService } from './item-images-cloudinary.service';
import { ItemsService } from './items.service';

describe('ItemsController', () => {
  let controller: ItemsController;
  const itemsService = {
    create: jest.fn(),
    update: jest.fn(),
    updateStock: jest.fn(),
    transfer: jest.fn(),
    findTransferReports: jest.fn(),
  };
  const itemImagesCloudinaryService = {
    uploadItemImage: jest.fn(),
    deleteItemImage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ItemsController],
      providers: [
        {
          provide: ItemsService,
          useValue: itemsService,
        },
        {
          provide: ItemImagesCloudinaryService,
          useValue: itemImagesCloudinaryService,
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

  it('delegates item transfers to the service', () => {
    const dto = { toStoreId: 'store-2', amount: 3 };

    controller.transfer('item-1', dto);

    expect(itemsService.transfer).toHaveBeenCalledWith('item-1', dto);
  });

  it('delegates transfer reports to the service', () => {
    const query = {
      from: '2026-05-01',
      to: '2026-05-28',
      fromStoreId: 'store-1',
      toStoreId: 'store-2',
    };

    controller.findTransferReports(query);

    expect(itemsService.findTransferReports).toHaveBeenCalledWith(query);
  });

  it('passes the uploaded Cloudinary image during create', async () => {
    const dto = { name: 'Cola', storeId: 'store-1' };
    itemImagesCloudinaryService.uploadItemImage.mockResolvedValue({
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/cola.png',
      imagePublicId: 'pos-rodmar/items/cola',
    });

    await controller.create(dto as any, {
      buffer: Buffer.from('img'),
      originalname: 'cola.png',
      mimetype: 'image/png',
    });

    expect(itemsService.create).toHaveBeenCalledWith({
      ...dto,
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/cola.png',
      imagePublicId: 'pos-rodmar/items/cola',
    });
  });

  it('passes the uploaded Cloudinary image during update', async () => {
    const dto = { name: 'Cola Zero' };
    itemImagesCloudinaryService.uploadItemImage.mockResolvedValue({
      imageUrl:
        'https://res.cloudinary.com/demo/image/upload/cola-zero.png',
      imagePublicId: 'pos-rodmar/items/cola-zero',
    });

    await controller.update('item-1', dto as any, {
      buffer: Buffer.from('img'),
      originalname: 'cola-zero.png',
      mimetype: 'image/png',
    });

    expect(itemsService.update).toHaveBeenCalledWith('item-1', {
      ...dto,
      imageUrl:
        'https://res.cloudinary.com/demo/image/upload/cola-zero.png',
      imagePublicId: 'pos-rodmar/items/cola-zero',
    });
  });

  it('cleans up a newly uploaded Cloudinary image when create fails', async () => {
    const upload = {
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/cola.png',
      imagePublicId: 'pos-rodmar/items/cola',
    };
    itemImagesCloudinaryService.uploadItemImage.mockResolvedValue(upload);
    itemsService.create.mockRejectedValue(new Error('db write failed'));

    await expect(
      controller.create(
        { name: 'Cola', storeId: 'store-1' } as any,
        {
          buffer: Buffer.from('img'),
          originalname: 'cola.png',
          mimetype: 'image/png',
        },
      ),
    ).rejects.toThrow('db write failed');

    expect(itemImagesCloudinaryService.deleteItemImage).toHaveBeenCalledWith(
      upload.imagePublicId,
    );
  });
});
