import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";

/**
 * Adds a `Server-Timing: app;dur=<ms>` response header measuring how long a
 * request spent inside the API (from this interceptor around the handler). It
 * surfaces in the browser's Network tab (Timing → Server Timing), so per-route
 * API latency can be read straight off production traffic with no external
 * tooling — the measurement baseline for the performance work. Deliberately
 * cheap: one header, no body change, HTTP requests only. See ADR 0042.
 */
@Injectable()
export class ServerTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only HTTP requests carry a response to annotate.
    if (context.getType() !== "http") {
      return next.handle();
    }

    const start = process.hrtime.bigint();
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        // The handler has resolved but Nest hasn't serialised the body yet, so
        // the header still lands before the response is flushed.
        if (!response.headersSent) {
          const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
          response.setHeader("Server-Timing", `app;dur=${durationMs.toFixed(1)}`);
        }
      }),
    );
  }
}
