import { ArgumentsHost, Catch, ExceptionFilter, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { SerializationConflictException } from "./run-serializable";

/**
 * Renders a SerializationConflictException as `503` + `Retry-After`.
 *
 * The header is the whole reason this filter exists: Nest's HttpException
 * carries a status and a body but no response headers, and "retry in a second"
 * is the actionable half of the answer. Registered in configure-app.ts so
 * production and every e2e test render it identically.
 */
@Catch(SerializationConflictException)
export class SerializationConflictFilter implements ExceptionFilter {
  private readonly logger = new Logger(SerializationConflictFilter.name);

  catch(exception: SerializationConflictException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    // A 5xx we intend, so it never reaches the Sentry filter — but sustained
    // conflicts on one route are worth seeing, so log rather than swallow.
    this.logger.warn(
      `Serializable conflict unresolved after ${exception.attempts} attempts: ${request.method} ${request.url}`,
    );

    response
      .setHeader("Retry-After", String(exception.retryAfterSeconds))
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}
