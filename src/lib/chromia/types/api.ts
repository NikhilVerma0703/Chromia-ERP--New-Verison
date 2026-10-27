import type { ErrorCode } from '@/lib/chromia/errors';

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}
