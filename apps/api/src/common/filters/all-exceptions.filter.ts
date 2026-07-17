import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError } from '@cuks/shared';
import { AppException } from '../exceptions/app.exception';
import { MetricsService } from '../../modules/monitoring/metrics.service';

/**
 * Renders every error as the standard envelope (docs/04 §REST):
 * `{ error: { code, message, details, requestId } }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly metrics: MetricsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = request.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'common.internal.error';
    let message = 'Internal server error';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
      code = `common.http.${status}`;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Only 5xx are unexpected — log with the stack for diagnosis and count it for the
      // admin health dashboard's "errors in 24h" widget (docs/modules/16 §7).
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
      this.metrics.recordError();
      message = 'Internal server error';
      details = undefined;
    }

    const body: ApiError = { error: { code, message, details, requestId } };
    void reply.status(status).send(body);
  }
}
