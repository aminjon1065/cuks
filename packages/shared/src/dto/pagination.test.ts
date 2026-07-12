import { describe, expect, it } from 'vitest';
import { paginationQuerySchema } from './pagination';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/index';

describe('paginationQuerySchema', () => {
  it('applies defaults when empty', () => {
    const parsed = paginationQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE });
  });

  it('coerces string query params to numbers', () => {
    expect(paginationQuerySchema.parse({ page: '3', limit: '20' })).toEqual({ page: 3, limit: 20 });
  });

  it('rejects a limit above the maximum', () => {
    expect(() => paginationQuerySchema.parse({ limit: MAX_PAGE_SIZE + 1 })).toThrow();
  });
});
