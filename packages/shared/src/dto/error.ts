import { z } from 'zod';

/**
 * Standard API error envelope (docs/04 §REST). Codes are `module.entity.reason`;
 * the frontend maps the code to an i18n string. `message` is English (for logs).
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}
