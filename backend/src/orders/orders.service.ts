import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import crypto from "node:crypto";
import { AuthUser } from "../auth/auth.types";
import {
  CD_STORE_ID,
  DELIVERY_METHODS,
  FRETE_SIMULADO,
  NotificationRow,
  OrderView,
  RESERVA_AUTO_EXPIRAR,
  RESERVA_HORAS,
  RETIRADA_PRAZO_DIAS,
  SECRET_TOKEN_KEY,
  SLOT_HORA_FIM,
  SLOT_HORA_INICIO,
  TRANSFER_ETA_DIAS,
} from "../common/constants";
import { OperadoraCartaoService } from "../payments/operadora-cartao.service";
import { PixService } from "../payments/pix.service";
import { ProductsService } from "../products/products.service";
import { StoresService } from "../stores/stores.service";
import { AuditService } from "../supabase/audit.service";
import { SchemaService } from "../supabase/schema.service";
import { SupabaseService } from "../supabase/supabase.service";
import {
  CheckoutDto,
  CreateOrderDto,
  PaymentMethodDto,
  RegisterRupturaDto,
  SeparateOrderDto,
  UpdateOrderStatusDto,
  ValidatePickupDto,
} from "./dto/order.dto";
import { ThirdPartyCodeService } from "./third-party-code.service";

const STATUS_ENCERRADOS = [
  "entregue_cliente",
  "retirado",
  "cancelado_ruptura",
  "cancelado_expirado",
  "cancelado",
];
const STATUS_AGUARDANDO = ["aguardando_separacao", "aguardando_preparacao"];

type Entrega = "retirar_na_loja" | "entrega_padrao";

interface LinhaCarrinho {
  productId: number;
  name: string;
  price: number;
  quantity: number;
  delivery: Entrega;
  /** S3-25: loja/CD de onde o item é transferido (null = estoque da própria filial). */
  originStoreId: number | null;
}

interface PedidoPronto {
  customerName: string;
  customerCpf: string;
  storeId: number | null;
  storeName: string;
  slot: string | null;
  shippingAddress: string | null;
  linhas: LinhaCarrinho[];
  subtotal: number;
  shipping: number;
  total: number;
  extrasEmUso: boolean;
}

interface PagamentoAprovado {
  method: string;
  masked: string;
  detail: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly storesService: StoresService,
    private readonly productsService: ProductsService,
    private readonly operadoraCartaoService: OperadoraCartaoService,
    private readonly pixService: PixService,
    private readonly thirdPartyCodeService: ThirdPartyCodeService,
    private readonly schema: SchemaService,
    private readonly audit: AuditService
  ) {}

  private nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "");
  }

  private dbError(message: string): InternalServerErrorException {
    return new InternalServerErrorException(
      `Erro no banco de dados (Supabase): ${message}`
    );
  }

  /** created_at/updated_at são gravados em UTC sem o "Z". */
  private parseUtc(value: string): number {
    return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`).getTime();
  }

  /**
   * Gera voucher autenticado com assinatura HMAC resumida para garantir
   * unicidade e evitar falsificações na baixa presencial (RNF003).
   * Formato amigável: HV-[ID]-XXXX-XXXX
   */
  private generatePickupCode(orderId: number): string {
    if (!SECRET_TOKEN_KEY) {
      throw new InternalServerErrorException(
        "SECRET_TOKEN_KEY ausente nas variáveis de ambiente (RNF002/RNF003: segredos fora do código)."
      );
    }
    const salt = crypto.randomBytes(4).toString("hex").toUpperCase();
    const signature = crypto
      .createHmac("sha256", Buffer.from(SECRET_TOKEN_KEY, "utf-8"))
      .update(Buffer.from(`${orderId}-${salt}`, "utf-8"))
      .digest("hex")
      .slice(0, 4)
      .toUpperCase();

    return `HV-${String(orderId).padStart(4, "0")}-${salt.slice(0, 4)}-${signature}`;
  }

  private async createNotification(
    orderId: number,
    message: string
  ): Promise<void> {
    const supabase = this.supabaseService.client;
    const { error } = await supabase.from("notifications").insert({
      order_id: orderId,
      message,
      created_at: this.nowIso(),
    });

    if (error) {
      throw this.dbError(error.message);
    }
  }

  private mapOrderRow(row: any): OrderView {
    const product = Array.isArray(row.products)
      ? row.products[0]
      : row.products;
    const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;

    const aguardando = STATUS_AGUARDANDO.includes(row.status);
    const reservedUntil =
      aguardando && row.delivery_method === "retirar_na_loja" && row.created_at
        ? new Date(
            this.parseUtc(row.created_at) + RESERVA_HORAS * 3600_000
          )
            .toISOString()
            .replace(/\.\d{3}Z$/, "")
        : null;

    return {
      id: Number(row.id),
      customer_name: row.customer_name,
      customer_cpf: row.customer_cpf ?? null,
      delivery_method: row.delivery_method,
      store_id: store?.id ?? row.store_id ?? null,
      product_id: product?.id ?? row.product_id,
      quantity: Number(row.quantity),
      status: row.status,
      pickup_code: row.pickup_code ?? null,
      card_number_masked: row.card_number_masked ?? null,
      payment_status: row.payment_status ?? null,
      third_party_name: row.third_party_name ?? null,
      third_party_cpf: row.third_party_cpf ?? null,
      refund_requested: Number(row.refund_requested ?? 0),
      cancellation_reason: row.cancellation_reason ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      product_name: product?.name ?? "",
      product_category: product?.category ?? undefined,
      product_price:
        product?.price !== undefined ? Number(product.price) : undefined,
      product_image_url: product?.image_url ?? null,
      product_sku: product?.sku ?? null,
      product_barcode: product?.barcode ?? null,
      store_name: store?.name ?? null,
      store_address: store?.address ?? null,
      store_city: store?.city ?? null,
      reserved_until: reservedUntil,
      pickup_slot: row.pickup_slot ?? null,
      shipping_address: row.shipping_address ?? null,
      shipping_cost:
        row.shipping_cost !== undefined && row.shipping_cost !== null
          ? Number(row.shipping_cost)
          : null,
      payment_method: row.payment_method ?? null,
      payment_detail: row.payment_detail ?? null,
      origin_store_id:
        row.origin_store_id !== undefined && row.origin_store_id !== null
          ? Number(row.origin_store_id)
          : null,
      origin_store_name: null,
      transfer_eta_days:
        row.transfer_eta_days !== undefined && row.transfer_eta_days !== null
          ? Number(row.transfer_eta_days)
          : null,
    };
  }

  /** S3-25: preenche o nome da loja/CD de origem das transferências. */
  private async attachOriginNames(orders: OrderView[]): Promise<OrderView[]> {
    const ids = [
      ...new Set(
        orders
          .map((o) => o.origin_store_id)
          .filter((id): id is number => typeof id === "number")
      ),
    ];
    if (ids.length === 0) return orders;

    const { data } = await this.supabaseService.client
      .from("stores")
      .select("id, name")
      .in("id", ids);
    const names = new Map<number, string>(
      (data ?? []).map((s: any) => [Number(s.id), s.name as string])
    );
    for (const order of orders) {
      if (order.origin_store_id) {
        order.origin_store_name = names.get(order.origin_store_id) ?? null;
      }
    }
    return orders;
  }

  private readonly ORDER_SELECT = `
        *,
        products (id, name, category, price, image_url, sku, barcode),
        stores (id, name, address, city)
      `;

  private async getOrder(orderId: number): Promise<OrderView | null> {
    const supabase = this.supabaseService.client;
    const { data, error } = await supabase
      .from("orders")
      .select(this.ORDER_SELECT)
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      throw this.dbError(error.message);
    }
    if (!data) {
      return null;
    }

    const [order] = await this.attachOriginNames([this.mapOrderRow(data)]);
    return order;
  }

  /**
   * Fila de pedidos da filial. Só mostra retirada na loja: itens com entrega
   * (S3-20) não passam pelo balcão. Com janela de retirada (S3-22), o que tem
   * horário marcado vem primeiro, do mais cedo para o mais tarde.
   */
  async listOrders(
    storeId?: string | number | null,
    status?: string | null,
    includeDelivery = false
  ): Promise<OrderView[]> {
    if (RESERVA_AUTO_EXPIRAR) {
      await this.expireOverdue({});
    }

    const supabase = this.supabaseService.client;
    let query = supabase.from("orders").select(this.ORDER_SELECT);

    if (!includeDelivery) {
      query = query.eq("delivery_method", "retirar_na_loja");
    }
    if (storeId !== undefined && storeId !== null && storeId !== "") {
      query = query.eq("store_id", Number(storeId));
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("id", { ascending: false });

    if (error) {
      throw this.dbError(error.message);
    }

    const orders = (data ?? []).map((row) => this.mapOrderRow(row));
    orders.sort((a, b) => {
      if (a.pickup_slot && b.pickup_slot) {
        return a.pickup_slot.localeCompare(b.pickup_slot) || a.id - b.id;
      }
      if (a.pickup_slot) return -1;
      if (b.pickup_slot) return 1;
      return b.id - a.id;
    });
    return this.attachOriginNames(orders);
  }

  async findOrder(orderId: number): Promise<OrderView> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new NotFoundException("Pedido nao encontrado.");
    }
    return order;
  }

  async listNotifications(orderId: number): Promise<NotificationRow[]> {
    await this.findOrder(orderId);

    const supabase = this.supabaseService.client;
    const { data, error } = await supabase
      .from("notifications")
      .select("id, order_id, message, created_at")
      .eq("order_id", orderId)
      .order("id", { ascending: true });

    if (error) {
      throw this.dbError(error.message);
    }

    return (data ?? []).map((n: any) => ({
      id: Number(n.id),
      order_id: Number(n.order_id),
      message: n.message,
      created_at: n.created_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // S3-22 - Janela de retirada
  // ---------------------------------------------------------------------------

  /** Data/hora de agora no horário de Brasília, no formato AAAA-MM-DDTHH:MM. */
  private agoraBrasilia(): string {
    return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16);
  }

  private validarSlot(slot: string): void {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/.exec(slot);
    if (!m) {
      throw new BadRequestException(
        "pickup_slot deve ser uma hora cheia no formato AAAA-MM-DDTHH:00."
      );
    }
    const [, ano, mes, dia, hora] = m;
    const data = new Date(`${ano}-${mes}-${dia}T00:00:00Z`);
    if (
      Number.isNaN(data.getTime()) ||
      data.toISOString().slice(0, 10) !== `${ano}-${mes}-${dia}`
    ) {
      throw new BadRequestException("pickup_slot com data inválida.");
    }
    const h = Number(hora);
    if (h < SLOT_HORA_INICIO || h >= SLOT_HORA_FIM) {
      throw new BadRequestException(
        `A retirada só pode ser agendada entre ${String(SLOT_HORA_INICIO).padStart(2, "0")}h e ${String(SLOT_HORA_FIM).padStart(2, "0")}h.`
      );
    }
    if (slot <= this.agoraBrasilia()) {
      throw new BadRequestException(
        "Escolha uma janela de retirada no futuro."
      );
    }
  }

  private async contarPorSlot(
    storeId: number,
    prefix: string
  ): Promise<Map<string, number>> {
    const { data, error } = await this.supabaseService.client
      .from("orders")
      .select("pickup_slot, status")
      .eq("store_id", storeId)
      .like("pickup_slot", `${prefix}%`);
    if (error) {
      throw this.dbError(error.message);
    }
    const contagem = new Map<string, number>();
    for (const row of data ?? []) {
      if (!row.pickup_slot) continue;
      if (["cancelado_ruptura", "cancelado_expirado", "cancelado"].includes(row.status)) {
        continue;
      }
      contagem.set(row.pickup_slot, (contagem.get(row.pickup_slot) ?? 0) + 1);
    }
    return contagem;
  }

  /** Janelas de 1 h do dia, com quantos pedidos já ocupam cada uma (limite = capacity da filial). */
  async listPickupSlots(storeId: number, date?: string | null) {
    if (!(await this.schema.has("orders_extra"))) {
      throw new ServiceUnavailableException(this.schema.missingMessage());
    }
    const store = await this.storesService.findActiveStoreById(storeId);
    if (!store) {
      throw new NotFoundException("Filial nao encontrada ou inativa.");
    }
    const dia = date || this.agoraBrasilia().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      throw new BadRequestException("date deve estar no formato AAAA-MM-DD.");
    }

    const ocupadas = await this.contarPorSlot(storeId, dia);
    const agora = this.agoraBrasilia();
    const slots: Record<string, unknown>[] = [];
    for (let h = SLOT_HORA_INICIO; h < SLOT_HORA_FIM; h++) {
      const hh = String(h).padStart(2, "0");
      const slot = `${dia}T${hh}:00`;
      const used = ocupadas.get(slot) ?? 0;
      slots.push({
        slot,
        label: `${hh}:00 às ${String(h + 1).padStart(2, "0")}:00`,
        used,
        capacity: store.capacity,
        available: Math.max(store.capacity - used, 0),
        past: slot <= agora,
      });
    }
    return { store_id: storeId, date: dia, capacity: store.capacity, slots };
  }

  // ---------------------------------------------------------------------------
  // Carrinho / checkout (UC003, S3-15, S3-20, S3-22, S3-23, S3-25)
  // ---------------------------------------------------------------------------

  /**
   * UC003 - Finalizar Compra de um item (Orquestrado pelo ControladorPedido via padrão BCE).
   * É o carrinho com uma linha só.
   */
  async createOrder(payload: CreateOrderDto): Promise<OrderView> {
    const productId =
      payload.product_id !== undefined && payload.product_id !== null
        ? Number(payload.product_id)
        : null;
    if (!productId || Number.isNaN(productId)) {
      throw new BadRequestException("Informe o product_id.");
    }
    const quantity = Number(payload.quantity ?? 1);
    if (Number.isNaN(quantity) || quantity < 1) {
      throw new BadRequestException("A quantidade deve ser maior que zero.");
    }

    const orders = await this.createCheckout({
      ...payload,
      customer_name: String(payload.customer_name ?? "Cliente MegaLoja"),
      customer_cpf: String(payload.customer_cpf ?? "000.000.000-00"),
      items: [{ product_id: productId, quantity }],
    });
    return orders[0];
  }

  /**
   * Lê o carrinho, valida tudo e calcula o total. Com `verificarEstoque` também
   * confere a disponibilidade na filial (ou na origem da transferência).
   */
  private async montarPedido(
    payload: CheckoutDto,
    verificarEstoque: boolean
  ): Promise<PedidoPronto> {
    const customerName = String(payload.customer_name ?? "").trim();
    const customerCpf = String(payload.customer_cpf ?? "").trim();
    const entregaPadrao = String(
      payload.delivery_method ?? "retirar_na_loja"
    ).trim();
    const storeId =
      payload.store_id !== undefined && payload.store_id !== null
        ? Number(payload.store_id)
        : null;
    const slot = payload.pickup_slot ? String(payload.pickup_slot).trim() : null;
    const shippingAddress = payload.shipping_address
      ? String(payload.shipping_address).trim()
      : null;

    if (!customerName) {
      throw new BadRequestException("Informe o nome do cliente.");
    }
    if (!DELIVERY_METHODS.has(entregaPadrao)) {
      throw new BadRequestException(
        "delivery_method deve ser 'retirar_na_loja' ou 'entrega_padrao'."
      );
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new BadRequestException("O carrinho está vazio.");
    }

    // Junta linhas repetidas (mesmo produto, mesma modalidade, mesma origem).
    const agrupadas = new Map<
      string,
      { productId: number; quantity: number; delivery: Entrega; originStoreId: number | null }
    >();
    let entregaExplicita = false;
    for (const item of payload.items) {
      const productId = Number(item?.product_id);
      const quantity = Number(item?.quantity ?? 1);
      if (!Number.isInteger(productId) || productId < 1) {
        throw new BadRequestException("Item do carrinho sem product_id válido.");
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new BadRequestException("A quantidade deve ser maior que zero.");
      }
      const delivery = String(item?.delivery ?? entregaPadrao).trim();
      if (item?.delivery !== undefined) entregaExplicita = true;
      if (!DELIVERY_METHODS.has(delivery)) {
        throw new BadRequestException(
          "delivery do item deve ser 'retirar_na_loja' ou 'entrega_padrao'."
        );
      }
      let originStoreId: number | null = null;
      if (item?.transfer_from !== undefined && item?.transfer_from !== null) {
        originStoreId = Number(item.transfer_from);
        if (!Number.isInteger(originStoreId) || originStoreId < 1) {
          throw new BadRequestException("transfer_from inválido.");
        }
        if (delivery !== "retirar_na_loja") {
          throw new BadRequestException(
            "A transferência entre filiais só vale para itens de retirada na loja."
          );
        }
      }
      const chave = `${productId}|${delivery}|${originStoreId ?? 0}`;
      const atual = agrupadas.get(chave);
      if (atual) {
        atual.quantity += quantity;
      } else {
        agrupadas.set(chave, {
          productId,
          quantity,
          delivery: delivery as Entrega,
          originStoreId,
        });
      }
    }

    const temRetirada = [...agrupadas.values()].some(
      (l) => l.delivery === "retirar_na_loja"
    );
    const temEntrega = [...agrupadas.values()].some(
      (l) => l.delivery === "entrega_padrao"
    );
    const usaTransferencia = [...agrupadas.values()].some(
      (l) => l.originStoreId !== null
    );
    // Endereço e frete só entram quando o cliente escolhe a entrega por item
    // (S3-20) ou informa o endereço; o fluxo antigo de entrega continua igual.
    const usaEntregaNova = temEntrega && (entregaExplicita || !!shippingAddress);

    if (temRetirada && !storeId) {
      throw new BadRequestException(
        "A selecao de filial fisica e obrigatoria para retirada na loja."
      );
    }
    if (usaEntregaNova && (!shippingAddress || shippingAddress.length < 8)) {
      throw new BadRequestException(
        "Informe o endereço de entrega (rua, número, cidade) para os itens com entrega."
      );
    }
    if (slot && !temRetirada) {
      throw new BadRequestException(
        "A janela de retirada só vale para pedidos com retirada na loja."
      );
    }

    const extrasPrecisam = Boolean(slot) || usaEntregaNova || usaTransferencia;
    const extrasOk = await this.schema.has("orders_extra");
    if (extrasPrecisam && !extrasOk) {
      throw new ServiceUnavailableException(this.schema.missingMessage());
    }

    let storeName = "Envio Domiciliar";
    if (temRetirada && storeId) {
      const store = await this.storesService.findActiveStoreById(storeId);
      if (!store) {
        throw new NotFoundException(
          "Filial fisica selecionada nao encontrada ou inativa."
        );
      }
      storeName = store.name;
    }

    const linhas: LinhaCarrinho[] = [];
    const problemas: string[] = [];
    for (const linha of agrupadas.values()) {
      const product = await this.productsService.findProductById(linha.productId);
      if (!product) {
        throw new NotFoundException(
          `Produto ${linha.productId} nao encontrado no catalogo.`
        );
      }
      linhas.push({
        productId: linha.productId,
        name: product.name,
        price: product.price,
        quantity: linha.quantity,
        delivery: linha.delivery,
        originStoreId: linha.originStoreId,
      });

      if (!verificarEstoque || linha.delivery !== "retirar_na_loja" || !storeId) {
        continue;
      }

      const origem = linha.originStoreId ?? storeId;
      if (linha.originStoreId !== null) {
        if (linha.originStoreId === storeId) {
          throw new BadRequestException(
            "A origem da transferência precisa ser diferente da filial de retirada."
          );
        }
        const opcoes = await this.storesService.listTransferOptions(
          storeId,
          linha.productId,
          linha.quantity
        );
        if (!opcoes.some((o) => o.store_id === linha.originStoreId)) {
          problemas.push(
            `${product.name}: a origem ${linha.originStoreId} não tem ${linha.quantity} unidade(s) ou não pode transferir`
          );
          continue;
        }
        continue;
      }

      const { disponivel, available } =
        await this.storesService.consultarDisponibilidade(
          origem,
          linha.productId,
          linha.quantity
        );
      if (!disponivel) {
        problemas.push(
          `${product.name} (pedido: ${linha.quantity}, disponível: ${available})`
        );
      }
    }

    if (problemas.length > 0) {
      throw new ConflictException(
        `Item indisponivel na filial '${storeName}': ${problemas.join("; ")}. ` +
          "Ajuste o carrinho, escolha outra filial, altere para entrega domiciliar " +
          "ou peça a transferência de outra filial/centro de distribuição " +
          "(GET /api/stores/:id/transfer-options)."
      );
    }

    // S3-22: janela de retirada dentro da capacidade da filial.
    if (slot && verificarEstoque && storeId) {
      this.validarSlot(slot);
      const store = await this.storesService.findActiveStoreById(storeId);
      const ocupadas = await this.contarPorSlot(storeId, slot);
      const novos = linhas.filter((l) => l.delivery === "retirar_na_loja").length;
      const usadas = ocupadas.get(slot) ?? 0;
      if (usadas + novos > (store?.capacity ?? 0)) {
        throw new ConflictException(
          `A janela ${slot.replace("T", " ")} está cheia na filial '${storeName}' ` +
            `(${usadas}/${store?.capacity ?? 0} pedidos). Escolha outro horário.`
        );
      }
    }

    const subtotal = linhas.reduce((soma, l) => soma + l.price * l.quantity, 0);
    const shipping = usaEntregaNova ? FRETE_SIMULADO : 0;

    return {
      customerName,
      customerCpf: customerCpf || "000.000.000-00",
      storeId: temRetirada ? storeId : null,
      storeName,
      slot,
      shippingAddress: usaEntregaNova ? shippingAddress : null,
      linhas,
      subtotal: Math.round(subtotal * 100) / 100,
      shipping,
      total: Math.round((subtotal + shipping) * 100) / 100,
      extrasEmUso: extrasOk,
    };
  }

  /** Total a pagar (itens + frete simulado), sem criar nada. Usado para gerar o Pix. */
  async quote(payload: CheckoutDto) {
    const pedido = await this.montarPedido(payload, false);
    return {
      items: pedido.linhas.map((l) => ({
        product_id: l.productId,
        name: l.name,
        price: l.price,
        quantity: l.quantity,
        delivery: l.delivery,
        subtotal: Math.round(l.price * l.quantity * 100) / 100,
      })),
      subtotal: pedido.subtotal,
      shipping: pedido.shipping,
      total: pedido.total,
      shipping_simulated: true,
    };
  }

  /**
   * S3-23 - Pagamento por cartão, Pix ou os dois (simulado).
   * Sem `payment`, vale o fluxo antigo: um cartão para o valor todo.
   */
  private async processarPagamentos(
    payload: CheckoutDto,
    total: number,
    extrasOk: boolean
  ): Promise<PagamentoAprovado> {
    const metodos = payload.payment?.methods;
    if (metodos === undefined || metodos === null) {
      const pagamento = this.operadoraCartaoService.processarPagamento(
        payload.card_number ?? "4111 1111 1111 1234",
        Boolean(payload.simulate_payment_failure ?? false)
      );
      return {
        method: "cartao",
        masked: pagamento.card_masked,
        detail: JSON.stringify([
          {
            type: "cartao",
            amount: total,
            masked: pagamento.card_masked,
            transacao_id: pagamento.transacao_id,
          },
        ]),
      };
    }

    if (!Array.isArray(metodos) || metodos.length < 1 || metodos.length > 2) {
      throw new BadRequestException("Use um ou dois meios de pagamento.");
    }

    const totalCentavos = Math.round(total * 100);
    const partes = metodos.map((m: PaymentMethodDto) => {
      if (m?.type !== "cartao" && m?.type !== "pix") {
        throw new BadRequestException("Meio de pagamento deve ser 'cartao' ou 'pix'.");
      }
      let centavos: number;
      if (m.amount === undefined || m.amount === null) {
        if (metodos.length > 1) {
          throw new BadRequestException(
            "Informe o valor (amount) de cada meio ao dividir o pagamento."
          );
        }
        centavos = totalCentavos;
      } else {
        const valor = Number(m.amount);
        if (!Number.isFinite(valor) || valor <= 0) {
          throw new BadRequestException("O valor de cada meio de pagamento deve ser maior que zero.");
        }
        centavos = Math.round(valor * 100);
      }
      return { metodo: m, centavos };
    });

    const soma = partes.reduce((acc, p) => acc + p.centavos, 0);
    if (soma !== totalCentavos) {
      throw new BadRequestException(
        `A soma dos meios de pagamento (R$ ${(soma / 100).toFixed(2)}) não confere com o total (R$ ${total.toFixed(2)}).`
      );
    }

    // 1) Pix primeiro (valida assinatura, validade e valor); 2) cartões.
    const pixValidados = partes
      .filter((p) => p.metodo.type === "pix")
      .map((parte) => ({
        parte,
        txid: this.pixService.verify(parte.metodo.pix_token, parte.centavos / 100)
          .txid,
      }));
    if (pixValidados.length > 0 && !extrasOk) {
      // Sem a coluna payment_detail não dá para impedir que o mesmo Pix pague dois pedidos.
      throw new ServiceUnavailableException(this.schema.missingMessage());
    }

    const detalhes: Record<string, unknown>[] = [];
    for (const { parte, txid } of pixValidados) {
      const { data: usados, error } = await this.supabaseService.client
        .from("orders")
        .select("id")
        .ilike("payment_detail", `%${txid}%`)
        .limit(1);
      if (error) throw this.dbError(error.message);
      if ((usados ?? []).length > 0) {
        throw new ConflictException("Este Pix já foi utilizado em outro pedido.");
      }
      detalhes.push({ type: "pix", amount: parte.centavos / 100, txid });
    }
    let masked = "";
    for (const parte of partes.filter((p) => p.metodo.type === "cartao")) {
      const pagamento = this.operadoraCartaoService.processarPagamento(
        parte.metodo.card_number ?? "",
        Boolean(parte.metodo.simulate_failure ?? payload.simulate_payment_failure ?? false)
      );
      masked ||= pagamento.card_masked;
      detalhes.push({
        type: "cartao",
        amount: parte.centavos / 100,
        masked: pagamento.card_masked,
        transacao_id: pagamento.transacao_id,
      });
    }

    const tipos = partes.map((p) => p.metodo.type);
    const pixTx = detalhes.find((d) => d.type === "pix")?.txid as string | undefined;
    return {
      method: tipos.join("+"),
      masked: masked || `PIX ${pixTx?.slice(0, 11) ?? ""}`,
      detail: JSON.stringify(detalhes),
    };
  }

  /**
   * S3-18: indicar terceiro exige o código enviado ao titular.
   * Devolve nome e CPF já normalizados (ou nulos quando não há terceiro).
   */
  private conferirTerceiro(
    payload: CheckoutDto,
    customerCpf: string
  ): { name: string | null; cpf: string | null } {
    const name = payload.third_party_name
      ? String(payload.third_party_name).trim()
      : null;
    const cpf = payload.third_party_cpf
      ? String(payload.third_party_cpf).trim()
      : null;
    if (!name && !cpf) {
      return { name: null, cpf: null };
    }
    if (!name || !cpf) {
      throw new BadRequestException(
        "Para indicar um terceiro informe o nome e o CPF dele."
      );
    }
    this.thirdPartyCodeService.assertValid(
      customerCpf,
      cpf,
      payload.third_party_code
    );
    return { name, cpf };
  }

  /**
   * S3-15 - Carrinho com vários itens (com S3-20: retirada e entrega no mesmo pedido).
   * Confere o estoque de TODOS os itens antes de cobrar, cobra uma vez e cria
   * um pedido por item (o esquema atual guarda um produto por pedido). Se algo
   * falhar no meio, devolve o estoque e cancela o que já foi criado.
   */
  async createCheckout(payload: CheckoutDto): Promise<OrderView[]> {
    const pedido = await this.montarPedido(payload, true);
    const terceiro = this.conferirTerceiro(payload, pedido.customerCpf);
    const pagamento = await this.processarPagamentos(
      payload,
      pedido.total,
      pedido.extrasEmUso
    );

    const criados: OrderView[] = [];
    let freteLancado = false;
    try {
      for (const linha of pedido.linhas) {
        const ehRetirada = linha.delivery === "retirar_na_loja";
        const origemNome = linha.originStoreId
          ? await this.storesService.findStoreName(linha.originStoreId)
          : null;
        const etaDias = linha.originStoreId
          ? linha.originStoreId === CD_STORE_ID
            ? TRANSFER_ETA_DIAS.cd
            : TRANSFER_ETA_DIAS.filial
          : null;

        let frete = 0;
        if (!ehRetirada && pedido.shipping > 0 && !freteLancado) {
          frete = pedido.shipping;
          freteLancado = true;
        }

        criados.push(
          await this.placeOrder({
            customerName: pedido.customerName,
            customerCpf: pedido.customerCpf,
            deliveryMethod: linha.delivery,
            storeId: ehRetirada ? pedido.storeId : null,
            storeName: pedido.storeName,
            productId: linha.productId,
            quantity: linha.quantity,
            cardMasked: pagamento.masked,
            thirdPartyName: terceiro.name,
            thirdPartyCpf: terceiro.cpf,
            extras: pedido.extrasEmUso
              ? {
                  pickup_slot: ehRetirada ? pedido.slot : null,
                  shipping_address: ehRetirada ? null : pedido.shippingAddress,
                  shipping_cost: frete,
                  payment_method: pagamento.method,
                  payment_detail: pagamento.detail,
                  origin_store_id: linha.originStoreId,
                  transfer_eta_days: etaDias,
                }
              : null,
            originStoreId: linha.originStoreId,
            originName: origemNome,
            etaDias,
            freteTexto:
              !ehRetirada && pedido.shipping > 0
                ? `Frete simulado R$ ${pedido.shipping.toFixed(2).replace(".", ",")} para ${pedido.shippingAddress}.`
                : null,
          })
        );
      }
    } catch (err) {
      await this.desfazerPedidos(criados, "Falha ao finalizar o carrinho.");
      throw err;
    }

    return criados;
  }

  /**
   * Grava o pedido, reserva o estoque (da filial ou da origem da transferência)
   * e registra a notificação. Usado por todo checkout.
   */
  private async placeOrder(input: {
    customerName: string;
    customerCpf: string;
    deliveryMethod: string;
    storeId: number | null;
    storeName: string;
    productId: number;
    quantity: number;
    cardMasked: string;
    thirdPartyName: string | null;
    thirdPartyCpf: string | null;
    extras: Record<string, unknown> | null;
    originStoreId: number | null;
    originName: string | null;
    etaDias: number | null;
    freteTexto: string | null;
  }): Promise<OrderView> {
    const timestamp = this.nowIso();
    const supabase = this.supabaseService.client;
    const { data: insertedOrder, error: insertErr } = await supabase
      .from("orders")
      .insert({
        customer_name: input.customerName,
        customer_cpf: input.customerCpf,
        delivery_method: input.deliveryMethod,
        store_id: input.storeId,
        product_id: input.productId,
        quantity: input.quantity,
        status: "aguardando_separacao",
        pickup_code: null,
        card_number_masked: input.cardMasked,
        payment_status: "aprovado",
        third_party_name: input.thirdPartyName || null,
        third_party_cpf: input.thirdPartyCpf || null,
        created_at: timestamp,
        updated_at: timestamp,
        ...(input.extras ?? {}),
      })
      .select("id")
      .single();

    if (insertErr || !insertedOrder) {
      throw this.dbError(insertErr?.message ?? "Falha ao inserir pedido.");
    }

    const orderId = Number(insertedOrder.id);

    if (input.deliveryMethod === "retirar_na_loja" && input.storeId) {
      await this.storesService.reservarEstoque(
        input.originStoreId ?? input.storeId,
        input.productId,
        input.quantity
      );
      const prazo = `Reserva válida por ${RESERVA_HORAS}h: a filial precisa separar o pedido até lá.`;
      if (input.originStoreId) {
        await this.createNotification(
          orderId,
          `Pedido #${orderId} confirmado com frete R$0,00. O item será transferido de ` +
            `${input.originName ?? `loja ${input.originStoreId}`} para ${input.storeName} ` +
            `(previsão: ${input.etaDias} dia(s) úteis). ${prazo}`
        );
      } else {
        await this.createNotification(
          orderId,
          `Pedido #${orderId} confirmado com frete R$0,00. Aguardando separacao física na filial ${input.storeName}. ${prazo}`
        );
      }
      const slot = input.extras?.pickup_slot as string | null | undefined;
      if (slot) {
        await this.createNotification(
          orderId,
          `Retirada agendada para ${slot.slice(8, 10)}/${slot.slice(5, 7)} às ${slot.slice(11, 16)} na filial ${input.storeName}.`
        );
      }
    } else {
      await this.createNotification(
        orderId,
        `Pedido #${orderId} recebido para entrega domiciliar.` +
          (input.freteTexto ? ` ${input.freteTexto}` : "")
      );
    }

    return this.findOrder(orderId);
  }

  private async desfazerPedidos(
    pedidos: OrderView[],
    motivo: string
  ): Promise<void> {
    const supabase = this.supabaseService.client;
    for (const pedido of pedidos) {
      try {
        if (pedido.delivery_method === "retirar_na_loja" && pedido.store_id) {
          await this.storesService.devolverEstoque(
            Number(pedido.origin_store_id ?? pedido.store_id),
            pedido.product_id,
            pedido.quantity
          );
        }
        await supabase
          .from("orders")
          .update({
            status: "cancelado",
            refund_requested: 1,
            cancellation_reason: motivo,
            updated_at: this.nowIso(),
          })
          .eq("id", pedido.id);
      } catch {
        // Melhor esforço: o erro original é o que importa para o cliente.
      }
    }
  }

  /** Pedidos do cliente logado (pelo CPF do cadastro). */
  async listOrdersByCpf(cpf: string): Promise<OrderView[]> {
    const supabase = this.supabaseService.client;
    const { data, error } = await supabase
      .from("orders")
      .select(this.ORDER_SELECT)
      .eq("customer_cpf", cpf)
      .order("id", { ascending: false });

    if (error) {
      throw this.dbError(error.message);
    }
    return this.attachOriginNames((data ?? []).map((row) => this.mapOrderRow(row)));
  }

  // ---------------------------------------------------------------------------
  // Operação da loja
  // ---------------------------------------------------------------------------

  /**
   * UC005 - Separar Pedido (Ator: Operador da Loja / Perfil Retaguarda)
   */
  async separateOrder(
    orderId: number,
    payload: SeparateOrderDto,
    actor?: AuthUser
  ): Promise<OrderView> {
    const barcodeOrSku = String(payload.barcode_or_sku ?? "").trim();

    const order = await this.findOrder(orderId);

    if (!STATUS_AGUARDANDO.includes(order.status)) {
      throw new BadRequestException(
        `O pedido nao esta aguardando separacao (status atual: ${order.status}).`
      );
    }

    const esperadoSku = (order.product_sku ?? "").trim().toUpperCase();
    const esperadoBarcode = (order.product_barcode ?? "").trim();
    const informado = barcodeOrSku.toUpperCase();

    if (
      informado &&
      informado !== esperadoSku &&
      informado !== esperadoBarcode
    ) {
      throw new BadRequestException(
        `Conferencia invalida! O codigo informado '${informado}' nao corresponde ao produto solicitado ` +
          `(SKU: ${esperadoSku} / Codigo de Barras: ${esperadoBarcode}).`
      );
    }

    const pickupCode = this.generatePickupCode(orderId);
    const timestamp = this.nowIso();

    const supabase = this.supabaseService.client;
    const { error } = await supabase
      .from("orders")
      .update({
        status: "pronto_retirada",
        pickup_code: pickupCode,
        updated_at: timestamp,
      })
      .eq("id", orderId);

    if (error) {
      throw this.dbError(error.message);
    }

    // S3-10: o envio do QR ao cliente é um MOCK (não há e-mail/push real).
    await this.createNotification(
      orderId,
      `Separacao fisica concluida! Pedido pronto para retirada na filial ${order.store_name}. ` +
        `Voucher digital liberado: ${pickupCode}.`
    );
    await this.createNotification(
      orderId,
      `[MOCK] Notificação enviada ao cliente ${order.customer_name}: "Seu pedido #${orderId} está pronto! ` +
        `Mostre o QR Code ${pickupCode} no balcão da ${order.store_name}." ` +
        `(Simulação: nenhum e-mail ou push real é disparado.)`
    );
    await this.audit.record(
      actor,
      "separar_pedido",
      orderId,
      informado
        ? `Bipagem/conferência: ${informado}`
        : "Separação confirmada sem leitura de código"
    );

    return this.findOrder(orderId);
  }

  /**
   * UC008 - Registrar Ruptura (Falta de Item) (Ponto de Extensão de UC005)
   */
  async registerRuptura(
    orderId: number,
    payload: RegisterRupturaDto,
    actor?: AuthUser
  ): Promise<OrderView> {
    const reason = String(
      payload.reason ?? "Ruptura de estoque identificada na prateleira fisica."
    ).trim();

    const order = await this.findOrder(orderId);

    if (STATUS_ENCERRADOS.includes(order.status)) {
      throw new ConflictException(
        `Pedido ja esta encerrado com status '${order.status}'.`
      );
    }

    const timestamp = this.nowIso();
    const supabase = this.supabaseService.client;
    const { error } = await supabase
      .from("orders")
      .update({
        status: "cancelado_ruptura",
        refund_requested: 1,
        cancellation_reason: reason,
        updated_at: timestamp,
      })
      .eq("id", orderId);

    if (error) {
      throw this.dbError(error.message);
    }

    // A ruptura é física: zera a prateleira de onde o item deveria sair.
    const lojaFisica = order.origin_store_id ?? order.store_id;
    if (lojaFisica && order.product_id) {
      await this.storesService.registrarRupturaFisica(
        lojaFisica,
        order.product_id
      );
    }

    const totalEstorno = ((order.product_price ?? 0) * order.quantity).toFixed(
      2
    );
    await this.createNotification(
      orderId,
      `UC008: Ruptura de estoque confirmada na filial. Pedido cancelado e estorno financeiro ` +
        `de R$ ${totalEstorno} solicitado a operadora.`
    );
    await this.audit.record(actor, "registrar_ruptura", orderId, reason);

    return this.findOrder(orderId);
  }

  /**
   * UC007 - Validar Retirada (Ator: Operador da Loja / Atendente)
   */
  async validatePickup(
    payload: ValidatePickupDto,
    actor?: AuthUser
  ): Promise<OrderView> {
    const orderId = payload.order_id ? Number(payload.order_id) : null;
    const pickupCode = String(payload.pickup_code ?? "").trim();
    const cpfBusca = String(payload.cpf ?? "").trim();
    const isThirdParty = Boolean(payload.is_third_party ?? false);
    const documentChecked = Boolean(payload.document_checked ?? false);

    // O CPF entra num filtro .or() do PostgREST: só aceita digitos, ponto e hifen.
    if (cpfBusca && !/^[0-9.\-]+$/.test(cpfBusca)) {
      throw new BadRequestException("CPF informado em formato invalido.");
    }

    const supabase = this.supabaseService.client;
    let order: OrderView | null = null;
    let via = "id do pedido";

    if (orderId) {
      order = await this.getOrder(orderId);
    } else if (pickupCode) {
      via = "QR Code/voucher";
      const { data: row, error } = await supabase
        .from("orders")
        .select("id")
        .eq("pickup_code", pickupCode)
        .maybeSingle();

      if (error) {
        throw this.dbError(error.message);
      }
      if (row) {
        order = await this.getOrder(Number(row.id));
      }
    } else if (cpfBusca) {
      via = "CPF";
      const { data: row, error } = await supabase
        .from("orders")
        .select("id")
        .or(`customer_cpf.eq.${cpfBusca},third_party_cpf.eq.${cpfBusca}`)
        .eq("status", "pronto_retirada")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw this.dbError(error.message);
      }
      if (row) {
        order = await this.getOrder(Number(row.id));
      }
    }

    if (!order) {
      throw new NotFoundException(
        "Pedido nao localizado para os dados informados."
      );
    }

    if (order.status !== "pronto_retirada") {
      if (order.status === "entregue_cliente" || order.status === "retirado") {
        throw new ConflictException(
          "Este pedido ja foi entregue anteriormente (duplicidade de baixa prevenida)."
        );
      } else if (
        order.status === "cancelado_ruptura" ||
        order.status === "cancelado_expirado" ||
        order.status === "cancelado"
      ) {
        throw new ConflictException(
          `Pedido cancelado (${order.cancellation_reason || "Cancelado"}). Retirada nao permitida.`
        );
      } else {
        throw new BadRequestException(
          `O pedido ainda nao esta pronto para retirada (status: ${order.status}).`
        );
      }
    }

    if (!documentChecked) {
      throw new BadRequestException(
        "E obrigatorio conferir o documento fisico (CPF e foto) antes de confirmar a entrega."
      );
    }

    if (isThirdParty) {
      if (!order.third_party_name || !order.third_party_cpf) {
        throw new ForbiddenException(
          "Nao ha terceiro autorizado cadastrado para este pedido."
        );
      }
    }

    const timestamp = this.nowIso();
    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        status: "entregue_cliente",
        updated_at: timestamp,
      })
      .eq("id", order.id);

    if (updateErr) {
      throw this.dbError(updateErr.message);
    }

    const quemRetirou = isThirdParty
      ? `Terceiro autorizado (${order.third_party_name})`
      : `Titular (${order.customer_name})`;

    await this.createNotification(
      order.id,
      `Entrega presencial confirmada para ${quemRetirou}. Baixa final efetuada com sucesso.`
    );
    await this.audit.record(
      actor,
      "baixa_retirada",
      order.id,
      `Via ${via}; retirou: ${quemRetirou}`
    );

    return this.findOrder(order.id);
  }

  // ---------------------------------------------------------------------------
  // Expiração (S3-24 e regra de abandono de 7 dias)
  // ---------------------------------------------------------------------------

  /**
   * Cancela o pedido e devolve a quantidade à prateleira de onde ela saiu.
   * Com `somenteSe`, só age se o pedido ainda estiver naquele status (evita
   * devolver o estoque duas vezes quando duas liberações rodam ao mesmo tempo).
   */
  private async cancelarEDevolver(
    order: OrderView,
    motivo: string,
    notificacao: string,
    somenteSe?: string[]
  ): Promise<boolean> {
    const supabase = this.supabaseService.client;
    let query = supabase
      .from("orders")
      .update({
        status: "cancelado_expirado",
        cancellation_reason: motivo,
        refund_requested: 1,
        updated_at: this.nowIso(),
      })
      .eq("id", order.id);
    if (somenteSe) {
      query = query.in("status", somenteSe);
    }
    const { data, error } = await query.select("id");
    if (error) {
      throw this.dbError(error.message);
    }
    if (!data || data.length === 0) {
      return false;
    }

    const lojaFisica = order.origin_store_id ?? order.store_id;
    if (order.delivery_method === "retirar_na_loja" && lojaFisica && order.product_id) {
      await this.storesService.devolverEstoque(
        lojaFisica,
        order.product_id,
        order.quantity
      );
    }
    await this.createNotification(order.id, notificacao);
    return true;
  }

  /**
   * Regra de Abandono (7 dias): Cancela pedido não retirado e devolve estoque à filial.
   */
  async expireAbandonedOrder(
    orderId: number,
    actor?: AuthUser
  ): Promise<OrderView> {
    const order = await this.findOrder(orderId);

    if (
      ["entregue_cliente", "retirado", "cancelado_ruptura", "cancelado_expirado"].includes(
        order.status
      )
    ) {
      throw new ConflictException("Pedido ja esta encerrado.");
    }

    await this.cancelarEDevolver(
      order,
      "Prazo limite de comparecimento de 7 dias expirado.",
      "Pedido expirado por nao-comparecimento (7 dias). Item devolvido a prateleira e estorno acionado."
    );
    await this.audit.record(
      actor,
      "cancelar_pedido",
      orderId,
      "Expiração manual (não comparecimento)"
    );

    return this.findOrder(orderId);
  }

  /**
   * S3-24 - Libera as reservas vencidas:
   *  - aguardando_separacao há mais de RESERVA_HORAS horas (a loja não separou);
   *  - pronto_retirada há mais de 7 dias (o cliente não veio).
   * A quantidade volta para o estoque da filial (ou da origem da transferência).
   * `hours` só pode ser alterado junto com `orderId` (usado nos testes).
   */
  async expireOverdue(
    options: { orderId?: number | null; hours?: number | null },
    actor?: AuthUser
  ): Promise<{ hours: number; expired: OrderView[] }> {
    if (options.hours !== undefined && options.hours !== null && !options.orderId) {
      throw new BadRequestException(
        "O parametro hours so pode ser usado junto com order_id."
      );
    }
    const hours =
      options.hours !== undefined && options.hours !== null
        ? Number(options.hours)
        : RESERVA_HORAS;
    if (!Number.isFinite(hours) || hours < 0) {
      throw new BadRequestException("hours deve ser um numero maior ou igual a zero.");
    }

    const supabase = this.supabaseService.client;
    const cortePreparo = new Date(Date.now() - hours * 3600_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "");
    const corteRetirada = new Date(
      Date.now() - RETIRADA_PRAZO_DIAS * 24 * 3600_000
    )
      .toISOString()
      .replace(/\.\d{3}Z$/, "");

    let qPreparo = supabase
      .from("orders")
      .select(this.ORDER_SELECT)
      .eq("delivery_method", "retirar_na_loja")
      .in("status", STATUS_AGUARDANDO)
      .lt("created_at", cortePreparo);
    let qRetirada = supabase
      .from("orders")
      .select(this.ORDER_SELECT)
      .eq("delivery_method", "retirar_na_loja")
      .eq("status", "pronto_retirada")
      .lt("updated_at", corteRetirada);
    if (options.orderId) {
      qPreparo = qPreparo.eq("id", options.orderId);
      qRetirada = qRetirada.eq("id", options.orderId);
    }

    const [preparo, retirada] = await Promise.all([qPreparo, qRetirada]);
    if (preparo.error) throw this.dbError(preparo.error.message);
    if (retirada.error) throw this.dbError(retirada.error.message);

    const expirados: OrderView[] = [];
    for (const row of preparo.data ?? []) {
      const order = this.mapOrderRow(row);
      const ok = await this.cancelarEDevolver(
        order,
        `Reserva vencida: a loja nao separou o pedido em ate ${hours}h.`,
        `Reserva do pedido #${order.id} vencida (${hours}h sem separacao). Item devolvido ao estoque e estorno acionado.`,
        STATUS_AGUARDANDO
      );
      if (ok) {
        expirados.push(order);
        await this.audit.record(
          actor,
          "expirar_reserva",
          order.id,
          `Reserva vencida (${hours}h sem separação)`
        );
      }
    }
    for (const row of retirada.data ?? []) {
      const order = this.mapOrderRow(row);
      const ok = await this.cancelarEDevolver(
        order,
        "Prazo limite de comparecimento de 7 dias expirado.",
        "Pedido expirado por nao-comparecimento (7 dias). Item devolvido a prateleira e estorno acionado.",
        ["pronto_retirada"]
      );
      if (ok) {
        expirados.push(order);
        await this.audit.record(
          actor,
          "expirar_reserva",
          order.id,
          "Não retirado em 7 dias"
        );
      }
    }

    const final: OrderView[] = [];
    for (const order of expirados) {
      final.push(await this.findOrder(order.id));
    }
    return { hours, expired: final };
  }

  async updateOrderStatus(
    orderId: number,
    payload: UpdateOrderStatusDto,
    actor?: AuthUser
  ): Promise<OrderView> {
    const newStatus = String(payload.status ?? "");

    const statusAliases: Record<string, string> = {
      aguardando_preparacao: "aguardando_separacao",
      retirado: "entregue_cliente",
      cancelado: "cancelado_expirado",
    };
    const normalizedStatus = statusAliases[newStatus] ?? newStatus;

    // S3-16: operador só separa, bipa e dá baixa; cancelar é com gerente/empresa.
    if (normalizedStatus === "cancelado_expirado" && actor?.role === "operador") {
      throw new ForbiddenException(
        "Apenas gerente ou empresa podem cancelar pedidos."
      );
    }

    if (normalizedStatus === "pronto_retirada") {
      return this.separateOrder(orderId, payload, actor);
    } else if (normalizedStatus === "cancelado_ruptura") {
      return this.registerRuptura(orderId, payload, actor);
    } else if (normalizedStatus === "entregue_cliente") {
      return this.validatePickup(
        {
          order_id: orderId,
          pickup_code: payload.pickup_code,
          document_checked: true,
          is_third_party: Boolean(payload.is_third_party ?? false),
        },
        actor
      );
    } else if (normalizedStatus === "cancelado_expirado") {
      return this.expireAbandonedOrder(orderId, actor);
    } else {
      const supabase = this.supabaseService.client;
      const { error } = await supabase
        .from("orders")
        .update({
          status: normalizedStatus,
          updated_at: this.nowIso(),
        })
        .eq("id", orderId);

      if (error) {
        throw this.dbError(error.message);
      }
      await this.audit.record(
        actor,
        "alterar_status",
        orderId,
        `Novo status: ${normalizedStatus}`
      );

      return this.findOrder(orderId);
    }
  }
}
