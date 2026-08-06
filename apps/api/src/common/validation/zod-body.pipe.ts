import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

import { AppError } from '../errors/app-error.js';

@Injectable()
export class ZodBody<T> implements PipeTransform<unknown, T> {
	constructor(private readonly schema: ZodSchema<T>) {}

	transform(value: unknown, _metadata: ArgumentMetadata): T {
		const parsed = this.schema.safeParse(value);
		if (parsed.success) return parsed.data;

		const fields: Record<string, string> = {};
		for (const issue of parsed.error.issues) {
			const path = issue.path.join('.') || '(body)';
			fields[path] ??= issue.message;
		}

		throw new AppError('VALIDATION_FAILED', 'request body failed validation', fields);
	}
}
