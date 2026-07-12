import { type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppException } from '../exceptions/app.exception';

/**
 * Validates input against a shared Zod schema (docs/04: all input validated by
 * zod). On failure throws the standard 400 error with the flattened issues.
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppException.badRequest(
        'common.request.validation_failed',
        'Request validation failed',
        {
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      );
    }
    return result.data;
  }
}
