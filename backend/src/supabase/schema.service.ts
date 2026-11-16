import { Injectable } from "@nestjs/common";
import { SupabaseService } from "./supabase.service";

export type SchemaFeature = "orders_extra" | "audit_log";

const PROBES: Record<SchemaFeature, { table: string; columns: string }> = {
  // Colunas novas da tabela orders (migração 001): janela de retirada, entrega,
  // meio de pagamento e origem da transferência.
  orders_extra: {
    table: "orders",
    columns:
      "pickup_slot, shipping_address, shipping_cost, payment_method, payment_detail, origin_store_id, transfer_eta_days",
  },
  audit_log: { table: "audit_log", columns: "id" },
};

/**
 * Detecta se a migração SQL (backend/migrations/001_sprint3.sql) já foi aplicada.
 * Sem ela o sistema continua funcionando como antes; só os recursos novos que
 * dependem de colunas/tabelas novas avisam que a migração precisa ser rodada.
 */
@Injectable()
export class SchemaService {
  private readonly cache = new Map<
    SchemaFeature,
    { ok: boolean; checkedAt: number }
  >();

  constructor(private readonly supabaseService: SupabaseService) {}

  async has(feature: SchemaFeature): Promise<boolean> {
    const hit = this.cache.get(feature);
    // Positivo vale para sempre; negativo é conferido de novo a cada 30 s.
    if (hit && (hit.ok || Date.now() - hit.checkedAt < 30_000)) {
      return hit.ok;
    }

    const probe = PROBES[feature];
    const { error } = await this.supabaseService.client
      .from(probe.table)
      .select(probe.columns)
      .limit(1);

    const ok = !error;
    this.cache.set(feature, { ok, checkedAt: Date.now() });
    return ok;
  }

  /** Mensagem padrão para recursos que dependem da migração. */
  missingMessage(): string {
    return (
      "Este recurso depende da migração SQL 001 (backend/migrations/001_sprint3.sql), " +
      "que ainda não foi aplicada no Supabase."
    );
  }
}
