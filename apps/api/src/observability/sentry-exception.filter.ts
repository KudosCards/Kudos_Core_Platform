import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { Sentry } from "./sentry";

/**
 * Reports unexpected server errors to Sentry, then defers to Nest's default
 * exception handling for the actual HTTP response (unchanged behaviour). Only
 * 5xx / non-HTTP exceptions are reported — expected 4xx client errors
 * (NotFound, Forbidden, Conflict, validation) are normal control flow and would
 * only be noise. A no-op reporter when Sentry isn't initialised (no DSN).
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
