import { Injectable } from "@nestjs/common";
import {
  RNF001_SLA_LIMIT_MS,
  Rnf001Measurement,
  Rnf001OperationType,
} from "../constants";

@Injectable()
export class RnfMetricsService {
  private readonly history: Rnf001Measurement[] = [];
  private readonly maxHistorySize = 100;

  record(
    operation: Rnf001OperationType,
    action: string,
    durationMs: number,
    metadata?: Record<string, unknown>
  ): Rnf001Measurement {
    const roundedMs = Number(durationMs.toFixed(2));
    const entry: Rnf001Measurement = {
      operation,
      action,
      duration_ms: roundedMs,
      sla_limit_ms: RNF001_SLA_LIMIT_MS,
      compliant: roundedMs <= RNF001_SLA_LIMIT_MS,
      timestamp: new Date().toISOString(),
      metadata,
    };

    this.history.unshift(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.pop();
    }

    return entry;
  }

  private summarizeGroup(items: Rnf001Measurement[]) {
    if (items.length === 0) {
      return {
        count: 0,
        avg_ms: 0,
        max_ms: 0,
        min_ms: 0,
        compliant: true,
      };
    }

    const durations = items.map((i) => i.duration_ms);
    const total = durations.reduce((acc, v) => acc + v, 0);
    const max = Math.max(...durations);
    const min = Math.min(...durations);

    return {
      count: items.length,
      avg_ms: Number((total / items.length).toFixed(2)),
      max_ms: Number(max.toFixed(2)),
      min_ms: Number(min.toFixed(2)),
      compliant: items.every((i) => i.compliant),
    };
  }

  getSummary() {
    const total = this.history.length;
    const compliantCount = this.history.filter((m) => m.compliant).length;
    const violationsCount = total - compliantCount;
    const overallStats = this.summarizeGroup(this.history);

    const consultas = this.history.filter(
      (m) => m.operation === "consulta_estoque"
    );
    const reservas = this.history.filter(
      (m) => m.operation === "reserva_estoque"
    );

    return {
      rnf: "RNF001",
      description:
        "Tempo de resposta e sincronização para consulta e reserva de estoque <= 60 segundos (60.000 ms)",
      sla_limit_ms: RNF001_SLA_LIMIT_MS,
      sla_limit_seconds: RNF001_SLA_LIMIT_MS / 1000,
      status: violationsCount === 0 ? "COMPLIANT" : "VIOLATION_DETECTED",
      total_measurements: total,
      compliant_count: compliantCount,
      violations_count: violationsCount,
      compliance_rate_percent:
        total === 0 ? 100 : Number(((compliantCount / total) * 100).toFixed(2)),
      stats: {
        last_ms: this.history[0]?.duration_ms ?? 0,
        avg_ms: overallStats.avg_ms,
        min_ms: overallStats.min_ms,
        max_ms: overallStats.max_ms,
      },
      by_operation: {
        consulta_estoque: this.summarizeGroup(consultas),
        reserva_estoque: this.summarizeGroup(reservas),
      },
      recent_samples: this.history.slice(0, 20),
    };
  }
}
