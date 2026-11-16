import fs from "node:fs";
import path from "node:path";

function loadEnvFile(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "..", "..", "..", ".env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) continue;
      const key = line.slice(0, eqIndex).trim();
      const value = line
        .slice(eqIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

loadEnvFile();

export const HOST = process.env.HOST || "127.0.0.1";
export const PORT = Number(process.env.PORT || 5000);

// Sprint 3 (RNF002 / RNF003): Segredos estritamente fora do código-fonte (via variáveis de ambiente)
export const SUPABASE_URL = process.env.SUPABASE_URL || "";
export const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  "";

export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || "";
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const SECRET_TOKEN_KEY = process.env.SECRET_TOKEN_KEY || "";

// Sprint 3 (RNF002): Configuração de HTTPS em ambiente de demo/produção
export const FORCE_HTTPS =
  process.env.FORCE_HTTPS === "true" || Boolean(process.env.VERCEL);
export const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || "";
export const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || "";

// Sprint 3 (RNF001): Limite máximo de tempo de resposta para consulta e reserva de estoque (60s = 60.000ms)
export const RNF001_SLA_LIMIT_MS = Number(
  process.env.RNF001_SLA_LIMIT_MS || 60000
);

// Estados oficiais do ciclo de vida de um pedido Click & Collect (Trabalho G2).
export const ORDER_STATUS = new Set<string>([
  "aguardando_separacao", // UC003: Pedido registrado com status "Aguardando Separação"
  "pronto_retirada",      // UC005: Status atualizado para "Pronto para Retirada"
  "entregue_cliente",     // UC007: Pedido finalizado com status "Entregue ao Cliente"
  "cancelado_ruptura",    // UC008: Ruptura de Estoque (falta de item na prateleira + estorno)
  "cancelado_expirado",   // Cancelamento por não comparecimento / abandono de 7 dias
  // Aliases legados para compatibilidade:
  "aguardando_preparacao",
  "retirado",
  "cancelado",
]);

// S3-24: prazo (em horas) que a loja tem para separar o pedido depois do pagamento.
// Passado o prazo, a reserva é liberada e a quantidade volta para o estoque.
export const RESERVA_HORAS = Math.max(
  Number(process.env.RESERVA_HORAS || 48) || 48,
  1
);
// Pedido separado (pronto_retirada) e não retirado expira em 7 dias.
export const RETIRADA_PRAZO_DIAS = 7;
// Quando "true", a fila do operador já libera sozinha as reservas vencidas.
export const RESERVA_AUTO_EXPIRAR = process.env.RESERVA_AUTO_EXPIRAR === "true";

// S3-20: frete simulado (valor fixo por compra com algum item para entrega).
export const FRETE_SIMULADO = Number(process.env.FRETE_SIMULADO || 19.9);

// S3-25: Centro de Distribuição (loja inativa para retirada, mas com estoque próprio).
export const CD_STORE_ID = 99;
export const TRANSFER_ETA_DIAS = { filial: 1, cd: 3 } as const;

// S3-22: janelas de retirada de 1 hora, das 08h às 20h.
export const SLOT_HORA_INICIO = 8;
export const SLOT_HORA_FIM = 20;

// Modalidades aceitas pelo checkout.
export const DELIVERY_METHODS = new Set<string>([
  "entrega_padrao",
  "retirar_na_loja",
]);

export interface StoreRow {
  id: number;
  name: string;
  city: string;
  zip_code: string;
  address: string;
  capacity: number;
  active: number;
  stock?: number;
}

export interface ProductRow {
  id: number;
  name: string;
  category: string;
  price: number;
  image_url: string | null;
  sku: string | null;
  barcode: string | null;
  stock?: number;
  /** Estoque de todas as filiais (id da filial -> quantidade), com include=stock. */
  stocks?: Record<number, number>;
}

export interface OrderView {
  id: number;
  customer_name: string;
  customer_cpf: string | null;
  delivery_method: string;
  store_id?: number | null;
  product_id: number;
  quantity: number;
  status: string;
  pickup_code: string | null;
  card_number_masked?: string | null;
  payment_status?: string | null;
  third_party_name: string | null;
  third_party_cpf: string | null;
  refund_requested: number;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  product_name: string;
  product_category?: string;
  product_price?: number;
  product_image_url?: string | null;
  product_sku: string | null;
  product_barcode: string | null;
  store_name: string | null;
  store_address?: string | null;
  store_city?: string | null;
  /** S3-24: até quando a loja precisa separar o pedido (só em aguardando_separacao). */
  reserved_until?: string | null;
  /** S3-22: início da janela de retirada escolhida (AAAA-MM-DDTHH:00). */
  pickup_slot?: string | null;
  /** S3-20: endereço e frete dos itens com entrega. */
  shipping_address?: string | null;
  shipping_cost?: number | null;
  /** S3-23: cartao, pix ou cartao+pix. */
  payment_method?: string | null;
  payment_detail?: string | null;
  /** S3-25: de onde vem o item quando é transferido de outra filial / CD. */
  origin_store_id?: number | null;
  origin_store_name?: string | null;
  transfer_eta_days?: number | null;
}

export interface NotificationRow {
  id: number;
  order_id: number;
  message: string;
  created_at: string;
}

export type Rnf001OperationType = "consulta_estoque" | "reserva_estoque";

export interface Rnf001Measurement {
  operation: Rnf001OperationType;
  action: string;
  duration_ms: number;
  sla_limit_ms: number;
  compliant: boolean;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
