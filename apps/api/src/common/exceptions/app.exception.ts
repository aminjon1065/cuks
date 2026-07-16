import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application error carrying a stable `module.entity.reason` code (docs/04 §REST).
 * The exception filter renders it as `{ error: { code, message, details, requestId } }`.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }

  static unauthorized(code: string, message = 'Unauthorized'): AppException {
    return new AppException(code, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(code: string, message = 'Forbidden'): AppException {
    return new AppException(code, message, HttpStatus.FORBIDDEN);
  }

  static notFound(code: string, message = 'Not found'): AppException {
    return new AppException(code, message, HttpStatus.NOT_FOUND);
  }

  static conflict(code: string, message: string, details?: Record<string, unknown>): AppException {
    return new AppException(code, message, HttpStatus.CONFLICT, details);
  }

  static badRequest(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): AppException {
    return new AppException(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static unprocessable(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): AppException {
    return new AppException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  static tooManyRequests(code: string, message = 'Too many requests'): AppException {
    return new AppException(code, message, HttpStatus.TOO_MANY_REQUESTS);
  }

  static serviceUnavailable(code: string, message = 'Service unavailable'): AppException {
    return new AppException(code, message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
