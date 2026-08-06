import type { Readable } from 'node:stream';

import {
	DeleteObjectCommand,
	GetObjectCommand,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { IObjectStorage, StoredObject } from '@vpn/ports';

export interface S3ObjectStorageOptions {
	readonly bucket: string;
	readonly region: string;
	readonly endpoint?: string | undefined;
}

export class S3ObjectStorage implements IObjectStorage {
	readonly #client: S3Client;
	readonly #bucket: string;

	constructor(options: S3ObjectStorageOptions) {
		this.#client = new S3Client({
			region: options.region,
			...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
		});
		this.#bucket = options.bucket;
	}

	async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
		await this.#client.send(
			new PutObjectCommand({
				Bucket: this.#bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
			}),
		);
	}

	async get(key: string): Promise<StoredObject | null> {
		try {
			const response = await this.#client.send(
				new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
			);
			if (!response.Body) return null;

			return {
				body: await toBytes(response.Body as Readable),
				contentType: response.ContentType ?? 'application/octet-stream',
			};
		} catch (error) {
			if (error instanceof NoSuchKey) return null;
			if (isNotFound(error)) return null;
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
	}

	async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
		return getSignedUrl(this.#client, new GetObjectCommand({ Bucket: this.#bucket, Key: key }), {
			expiresIn: expiresInSeconds,
		});
	}
}

function isNotFound(error: unknown): boolean {
	const name = (error as { name?: string }).name;
	const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
	return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

async function toBytes(stream: Readable): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
	return new Uint8Array(Buffer.concat(chunks));
}
