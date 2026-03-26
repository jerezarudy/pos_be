import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { extname } from 'path';

type UploadedItemImageFile = {
  buffer?: Buffer;
  originalname?: string;
  mimetype?: string;
};

@Injectable()
export class ItemImagesCloudinaryService {
  private readonly logger = new Logger(ItemImagesCloudinaryService.name);
  private readonly cloudinaryUrl?: string;
  private readonly cloudName?: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly folder: string;

  constructor(private readonly configService: ConfigService) {
    this.cloudinaryUrl = this.readEnv('CLOUDINARY_URL');
    this.cloudName = this.readEnv('CLOUDINARY_CLOUD_NAME');
    this.apiKey = this.readEnv('CLOUDINARY_API_KEY');
    this.apiSecret = this.readEnv('CLOUDINARY_API_SECRET');
    this.folder =
      this.readEnv('CLOUDINARY_FOLDER') ?? 'pos-rodmar/items';

    if (this.isConfigured()) {
      if (this.cloudinaryUrl) {
        process.env.CLOUDINARY_URL = this.cloudinaryUrl;
        cloudinary.config(true);
      } else {
        cloudinary.config({
          cloud_name: this.cloudName,
          api_key: this.apiKey,
          api_secret: this.apiSecret,
        });
      }
    }
  }

  async uploadItemImage(file: UploadedItemImageFile) {
    this.assertConfigured();

    if (!file?.buffer?.length) {
      throw new InternalServerErrorException(
        'Uploaded file buffer is missing',
      );
    }

    return new Promise<{ imageUrl: string; imagePublicId: string }>(
      (resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: this.folder,
            public_id: this.buildPublicId(file.originalname),
            resource_type: 'image',
            overwrite: false,
          },
          (error, result) => {
            if (error || !result?.secure_url || !result.public_id) {
              this.logger.error(
                `Cloudinary upload failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              reject(
                new InternalServerErrorException(
                  'Failed to upload item image to Cloudinary',
                ),
              );
              return;
            }

            resolve({
              imageUrl: result.secure_url,
              imagePublicId: result.public_id,
            });
          },
        );

        uploadStream.end(file.buffer);
      },
    );
  }

  async deleteItemImage(imagePublicId?: unknown) {
    const normalized =
      typeof imagePublicId === 'string' ? imagePublicId.trim() : '';
    if (!normalized || !this.isConfigured()) return;

    try {
      const result = await cloudinary.uploader.destroy(normalized, {
        resource_type: 'image',
      });

      if (result.result === 'ok' || result.result === 'not found') return;

      this.logger.warn(
        `Unexpected Cloudinary destroy result for ${normalized}: ${result.result}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to delete Cloudinary image ${normalized}: ${String(error)}`,
      );
    }
  }

  private isConfigured() {
    return !!(
      this.cloudinaryUrl ||
      (this.cloudName && this.apiKey && this.apiSecret)
    );
  }

  private assertConfigured() {
    if (this.isConfigured()) return;

    throw new InternalServerErrorException(
      'Cloudinary is not configured. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
    );
  }

  private readEnv(key: string) {
    const value = this.configService.get<string>(key);
    const normalized = value?.trim();
    return normalized || undefined;
  }

  private buildPublicId(originalname?: string) {
    const rawBaseName =
      typeof originalname === 'string'
        ? originalname.slice(
            0,
            Math.max(0, originalname.length - extname(originalname).length),
          )
        : '';

    const normalizedBaseName =
      rawBaseName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'item-image';

    return `${normalizedBaseName}-${Date.now()}-${Math.round(
      Math.random() * 1e9,
    )}`;
  }
}
