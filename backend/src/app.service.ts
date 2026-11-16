import { Injectable } from "@nestjs/common";
import {
  FORCE_HTTPS,
  RNF001_SLA_LIMIT_MS,
  SECRET_TOKEN_KEY,
  SUPABASE_KEY,
  SUPABASE_URL,
} from "./common/constants";
import { RnfMetricsService } from "./common/metrics/rnf-metrics.service";
import { SchemaService } from "./supabase/schema.service";

@Injectable()
export class AppService {
  constructor(
    private readonly rnfMetricsService: RnfMetricsService,
    private readonly schema: SchemaService
  ) {}

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

  async getHealth() {
    const rnf001 = this.rnfMetricsService.getSummary();
    let migracao001 = { orders_extra: false, audit_log: false };
    try {
      migracao001 = {
        orders_extra: await this.schema.has("orders_extra"),
        audit_log: await this.schema.has("audit_log"),
      };
    } catch {
      // Sem credenciais do Supabase o health continua respondendo.
    }
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
      // Migração SQL 001 (backend/migrations): janela de retirada, entrega, Pix, transferência e auditoria.
      migracao_001: migracao001,
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
