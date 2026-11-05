import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Request, Response } from "express";
import { performance } from "node:perf_hooks";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { FORCE_HTTPS, RNF001_SLA_LIMIT_MS } from "../constants";

/**
 * Interceptor global da Sprint 3:
 * 1. Verifica protocolo HTTPS quando FORCE_HTTPS está ativo (RNF002) e injeta cabeçalho HSTS.
 * 2. Mede o tempo de resposta de todas as requisições HTTP e injeta cabeçalhos de auditoria do RNF001 (<= 60s).
 * 3. Anexa telemetria `rnf001_telemetry` nas respostas JSON de consulta e reserva de estoque.
 */
@Injectable()
export class RnfMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = performance.now();
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();

    const forwardedProto = req.headers["x-forwarded-proto"];
    const isHttps =
      req.secure ||
      forwardedProto === "https" ||
      (Array.isArray(forwardedProto) && forwardedProto.includes("https"));
    const isLocalhost =
      req.hostname === "localhost" || req.hostname === "127.0.0.1";

    if (FORCE_HTTPS && !isHttps && !isLocalhost) {
      throw new ForbiddenException(
        "RNF002: Conexao HTTPS obrigatoria no ambiente de demonstracao/producao."
      );
    }

    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
    res.setHeader("X-Transport-Security-Protocol", isHttps ? "https" : "http");

    return next.handle().pipe(
      map((data) => {
        const durationMs = Number((performance.now() - start).toFixed(2));
        const compliant = durationMs <= RNF001_SLA_LIMIT_MS;

        if (!res.headersSent) {
          res.setHeader("X-Response-Time-Ms", String(durationMs));
          res.setHeader("X-RNF001-SLA-Limit-Ms", String(RNF001_SLA_LIMIT_MS));
          res.setHeader("X-RNF001-Compliant", String(compliant));
        }

        const path = req.path || req.url || "";
        const isStockOrOrderEndpoint =
          path.startsWith("/api/stores") ||
          path.startsWith("/api/products") ||
          path === "/api/orders";

        if (
          isStockOrOrderEndpoint &&
          data &&
          typeof data === "object" &&
          !Array.isArray(data)
        ) {
          return {
            ...data,
            rnf001_telemetry: {
              duration_ms: durationMs,
              sla_limit_ms: RNF001_SLA_LIMIT_MS,
              compliant,
            },
          };
        }

        return data;
      })
    );
  }
}
