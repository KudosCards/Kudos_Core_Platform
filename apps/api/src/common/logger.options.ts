import type { Params } from "nestjs-pino";
import { redactUrlTokens } from "./redact-url-tokens";

/**
 * pino's request serializer, with the URL's token segment removed.
 *
 * `redact` only reaches named header paths, and the secret here is not in a
 * header — it is a path segment, logged as part of `url` on every request at
 * `info`. Rebuilding the serialized shape by hand rather than wrapping pino's
 * default keeps this independent of that default's fields changing underneath
 * us, and everything it emits is deliberate. See ADR 0187.
 */
export function redactingReqSerializer(req: {
  id?: unknown;
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
  remotePort?: number;
}): Record<string, unknown> {
  return {
    id: req.id,
    method: req.method,
    url: req.url ? redactUrlTokens(req.url) : req.url,
    headers: req.headers,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  };
}

export function loggerOptions(): Params {
  return {
    pinoHttp: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
      // Headers that carry a credential. The URL is handled by the serializer
      // below, because a path segment cannot be reached by a redact path.
      redact: ["req.headers.authorization", 'req.headers["x-api-key"]'],
      serializers: { req: redactingReqSerializer },
    },
  };
}
