import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { SchemaService } from "./schema.service";
import { SupabaseService } from "./supabase.service";

export interface AuditEntry {
  id: number;
  order_id: number | null;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

/**
 * S3-17 - Log de auditoria das ações do operador.
 * Cada bipagem, baixa de retirada, ruptura, cancelamento e alteração de produto
 * grava quem fez, quando, em qual pedido e o quê. Gravar o log nunca derruba a
 * operação principal: se a tabela ainda não existir (migração 001), só registra aviso.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schema: SchemaService
  ) {}

  async record(
    actor: AuthUser | undefined | null,
    action: string,
    orderId: number | null,
    detail?: string
  ): Promise<void> {
    try {
      if (!(await this.schema.has("audit_log"))) {
        return;
      }
      const { error } = await this.supabaseService.client
        .from("audit_log")
        .insert({
          order_id: orderId,
          user_id: actor?.id ?? null,
          user_email: actor?.email ?? null,
          user_role: actor?.role ?? null,
          action,
          detail: detail ?? null,
          created_at: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
        });
      if (error) {
        this.logger.warn(`Falha ao gravar auditoria: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(`Falha ao gravar auditoria: ${(err as Error).message}`);
    }
  }

  async list(options: {
    orderId?: number | null;
    limit?: number;
  }): Promise<AuditEntry[]> {
    if (!(await this.schema.has("audit_log"))) {
      throw new ServiceUnavailableException(this.schema.missingMessage());
    }
    let query = this.supabaseService.client
      .from("audit_log")
      .select(
        "id, order_id, user_id, user_email, user_role, action, detail, created_at"
      );
    if (options.orderId) {
      query = query.eq("order_id", options.orderId);
    }
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
    const { data, error } = await query
      .order("id", { ascending: false })
      .limit(limit);
    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
    return (data ?? []).map((row: any) => ({
      id: Number(row.id),
      order_id: row.order_id === null ? null : Number(row.order_id),
      user_id: row.user_id ?? null,
      user_email: row.user_email ?? null,
      user_role: row.user_role ?? null,
      action: row.action,
      detail: row.detail ?? null,
      created_at: row.created_at,
    }));
  }
}
