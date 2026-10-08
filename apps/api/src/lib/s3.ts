import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Config } from "../config";

/** Object-storage operations the API needs; injectable for tests. */
export interface S3Like {
  ensureBucket(): Promise<void>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  presignDownload(key: string, expiresSeconds?: number): Promise<string>;
}

/** S3-compatible store (MinIO in docker-compose) using path-style addressing. */
export class MinioObjectStore implements S3Like {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(cfg: S3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
    this.bucket = cfg.bucket;
  }

  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        // Concurrent creation or already exists — safe to ignore.
      }
    }
    this.bucketReady = true;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  async presignDownload(key: string, expiresSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresSeconds }
    );
  }
}
