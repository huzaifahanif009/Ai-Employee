import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { PraxisError } from '@praxis/contracts';
import { Response } from 'express';

/** RFC 9457 Problem Details for every error (prd/13 §1). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest();

    let status = 500;
    let code = 'INTERNAL';
    let title = 'Internal error';
    let detail: string | undefined;
    let meta: Record<string, unknown> = {};

    if (exception instanceof PraxisError) {
      status = exception.status;
      code = exception.code;
      title = exception.message;
      meta = exception.meta;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as Record<string, unknown> | string;
      title = typeof r === 'string' ? r : String(r['message'] ?? exception.message);
      code = mapHttpCode(status);
      if (typeof r === 'object' && Array.isArray(r['message'])) {
        detail = (r['message'] as string[]).join('; ');
        code = 'VALIDATION';
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
      this.log.error(exception.stack ?? exception.message);
    }

    res.status(status).type('application/problem+json').send({
      type: `https://praxis.dev/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title,
      status,
      detail,
      instance: req.originalUrl,
      code,
      meta,
    });
  }
}

function mapHttpCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'RBAC_DENIED';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}
