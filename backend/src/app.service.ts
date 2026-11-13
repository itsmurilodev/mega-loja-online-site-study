import { Injectable } from "@nestjs/common";
import {
  FORCE_HTTPS,
  RNF001_SLA_LIMIT_MS,
  SECRET_TOKEN_KEY,
  SUPABASE_KEY,
  SUPABASE_URL,
} from "./common/constants";
import { RnfMetricsService } from "./common/metrics/rnf-metrics.service";

@Injectable()
export class AppService {
  constructor(private readonly rnfMetricsService: RnfMetricsService) {}

  getApiIndex() {
    return {
      name: "MegaLoja Click & Collect API - Trabalho G2 Unilasalle",
      status: "online",
      sprint: "Sprint 3 (RNF001, RNF002, RNF003)",
      framework: "NestJS + TypeScript + Supabase",
      casos_de_uso: {
        UC003_finalizar_compra: "POST /api/orders",
        UC005_separar_pedido: "POST /api/orders/{id}/separate",
        UC008_registrar_ruptura: "POST /api/orders/{id}/rupture",
        UC007_validar_retirada: "POST /api/orders/validate-pickup",
        regra_abandono_expirar: "POST /api/orders/{id}/expire",
        consultas: {
          lojas: "GET /api/stores",
          produtos: "GET /api/products",
          pedidos: "GET /api/orders",
          notificacoes: "GET /api/orders/{id}/notifications",
          metricas_rnf001: "GET /api/metrics/rnf001",
        },
      },
    };
  }

  getHealth() {
    const rnf001 = this.rnfMetricsService.getSummary();
    return {
      status: "online",
      database: "supabase-postgresql",
      sprint: "Sprint 3 - Trabalho G2 Unilasalle",
      security_rnf002: {
        secrets_externalized: Boolean(
          SUPABASE_URL && SUPABASE_KEY && SECRET_TOKEN_KEY
        ),
        force_https_demo: FORCE_HTTPS,
      },
      rnf001_sla: {
        limit_ms: RNF001_SLA_LIMIT_MS,
        status: rnf001.status,
        total_measurements: rnf001.total_measurements,
        compliance_rate_percent: rnf001.compliance_rate_percent,
        avg_ms: rnf001.stats.avg_ms,
        max_ms: rnf001.stats.max_ms,
      },
    };
  }

  getRnf001Metrics() {
    return this.rnfMetricsService.getSummary();
  }
}
