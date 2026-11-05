import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import crypto from "node:crypto";
import {
  DELIVERY_METHODS,
  NotificationRow,
  OrderView,
  SECRET_TOKEN_KEY,
} from "../common/constants";
import { OperadoraCartaoService } from "../payments/operadora-cartao.service";
import { ProductsService } from "../products/products.service";
import { StoresService } from "../stores/stores.service";
import { SupabaseService } from "../supabase/supabase.service";
import {
  CreateOrderDto,
  RegisterRupturaDto,
  SeparateOrderDto,
  UpdateOrderStatusDto,
  ValidatePickupDto,
} from "./dto/order.dto";

@Injectable()
export class OrdersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly storesService: StoresService,
    private readonly productsService: ProductsService,
    private readonly operadoraCartaoService: OperadoraCartaoService
  ) {}

  private nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "");
  }

  /**
   * Gera voucher autenticado com assinatura HMAC resumida para garantir
   * unicidade e evitar falsificações na baixa presencial (RNF003).
   * Formato amigável: HV-[ID]-XXXX-XXXX
   */
  private generatePickupCode(orderId: number): string {
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
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
  }

  private mapOrderRow(row: any): OrderView {
    const product = Array.isArray(row.products)
      ? row.products[0]
      : row.products;
    const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;

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
      discount_coupon: row.discount_coupon ?? null,
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
    };
  }

  private async getOrder(orderId: number): Promise<OrderView | null> {
    const supabase = this.supabaseService.client;
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        products (id, name, category, price, image_url, sku, barcode),
        stores (id, name, address, city)
      `
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
    if (!data) {
      return null;
    }

    return this.mapOrderRow(data);
  }

  async listOrders(
    storeId?: string | number | null,
    status?: string | null
  ): Promise<OrderView[]> {
    const supabase = this.supabaseService.client;

    let query = supabase.from("orders").select(
      `
        id, customer_name, customer_cpf, delivery_method, store_id,
        product_id, quantity, status, pickup_code, third_party_name,
        third_party_cpf, discount_coupon, refund_requested, cancellation_reason,
        created_at, updated_at,
        products (id, name, image_url, sku, barcode),
        stores (id, name)
      `
    );

    if (storeId !== undefined && storeId !== null && storeId !== "") {
      query = query.eq("store_id", Number(storeId));
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("id", { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    return (data ?? []).map((row) => this.mapOrderRow(row));
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
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    return (data ?? []).map((n: any) => ({
      id: Number(n.id),
      order_id: Number(n.order_id),
      message: n.message,
      created_at: n.created_at,
    }));
  }

  /**
   * UC003 - Finalizar Compra (Orquestrado pelo ControladorPedido via padrão BCE)
   */
  async createOrder(payload: CreateOrderDto): Promise<OrderView> {
    const customerName = String(
      payload.customer_name ?? "Cliente MegaLoja"
    ).trim();
    const customerCpf = String(payload.customer_cpf ?? "000.000.000-00").trim();
    const deliveryMethod = String(
      payload.delivery_method ?? "retirar_na_loja"
    ).trim();
    const storeId =
      payload.store_id !== undefined && payload.store_id !== null
        ? Number(payload.store_id)
        : null;
    const productId =
      payload.product_id !== undefined && payload.product_id !== null
        ? Number(payload.product_id)
        : null;
    const quantity = Number(payload.quantity ?? 1);

    const cardNumber = payload.card_number ?? "4111 1111 1111 1234";
    const simulatePaymentFailure = Boolean(
      payload.simulate_payment_failure ?? false
    );

    const thirdPartyName = payload.third_party_name
      ? String(payload.third_party_name).trim()
      : null;
    const thirdPartyCpf = payload.third_party_cpf
      ? String(payload.third_party_cpf).trim()
      : null;

    if (!customerName) {
      throw new BadRequestException("Informe o nome do cliente.");
    }
    if (!DELIVERY_METHODS.has(deliveryMethod)) {
      throw new BadRequestException(
        "delivery_method deve ser 'retirar_na_loja' ou 'entrega_padrao'."
      );
    }
    if (!productId || Number.isNaN(productId)) {
      throw new BadRequestException("Informe o product_id.");
    }
    if (Number.isNaN(quantity) || quantity < 1) {
      throw new BadRequestException("A quantidade deve ser maior que zero.");
    }

    if (deliveryMethod === "retirar_na_loja" && !storeId) {
      throw new BadRequestException(
        "A selecao de filial fisica e obrigatoria para retirada na loja."
      );
    }

    const product = await this.productsService.findProductById(productId);
    if (!product) {
      throw new NotFoundException("Produto nao encontrado no catalogo.");
    }

    let storeName = "Envio Domiciliar";
    if (deliveryMethod === "retirar_na_loja" && storeId) {
      const store = await this.storesService.findActiveStoreById(storeId);
      if (!store) {
        throw new NotFoundException(
          "Filial fisica selecionada nao encontrada ou inativa."
        );
      }
      storeName = store.name;

      // UC002 - Consultar Disponibilidade de Estoque em Tempo Real
      const { disponivel, available } =
        await this.storesService.consultarDisponibilidade(
          storeId,
          productId,
          quantity
        );

      if (!disponivel) {
        throw new ConflictException(
          `Item indisponivel na filial '${storeName}'. Estoque atual: ${available}. ` +
            "Por favor, selecione outra filial ou altere para entrega domiciliar."
        );
      }
    }

    // RF003 / Fluxo Básico passo 6: Processamento de pagamento junto à Operadora de Cartão
    const pagamento = this.operadoraCartaoService.processarPagamento(
      cardNumber,
      simulatePaymentFailure
    );

    const initialStatus = "aguardando_separacao";
    const timestamp = this.nowIso();

    const supabase = this.supabaseService.client;
    const { data: insertedOrder, error: insertErr } = await supabase
      .from("orders")
      .insert({
        customer_name: customerName,
        customer_cpf: customerCpf,
        delivery_method: deliveryMethod,
        store_id: storeId,
        product_id: productId,
        quantity,
        status: initialStatus,
        pickup_code: null,
        card_number_masked: pagamento.card_masked,
        payment_status: "aprovado",
        third_party_name: thirdPartyName || null,
        third_party_cpf: thirdPartyCpf || null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select("id")
      .single();

    if (insertErr || !insertedOrder) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${insertErr?.message ?? "Falha ao inserir pedido."}`
      );
    }

    const orderId = Number(insertedOrder.id);

    if (deliveryMethod === "retirar_na_loja" && storeId) {
      await this.storesService.reservarEstoque(storeId, productId, quantity);
      await this.createNotification(
        orderId,
        `Pedido #${orderId} confirmado com frete R$0,00. Aguardando separacao física na filial ${storeName}.`
      );
    } else {
      await this.createNotification(
        orderId,
        `Pedido #${orderId} recebido para entrega domiciliar.`
      );
    }

    return this.findOrder(orderId);
  }

  /**
   * UC005 - Separar Pedido (Ator: Operador da Loja / Perfil Retaguarda)
   */
  async separateOrder(
    orderId: number,
    payload: SeparateOrderDto
  ): Promise<OrderView> {
    const barcodeOrSku = String(payload.barcode_or_sku ?? "").trim();

    const order = await this.findOrder(orderId);

    if (
      order.status !== "aguardando_separacao" &&
      order.status !== "aguardando_preparacao"
    ) {
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
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    await this.createNotification(
      orderId,
      `Separacao fisica concluida! Pedido pronto para retirada na filial ${order.store_name}. ` +
        `Voucher digital liberado: ${pickupCode}.`
    );

    return this.findOrder(orderId);
  }

  /**
   * UC008 - Registrar Ruptura (Falta de Item) (Ponto de Extensão de UC005)
   */
  async registerRuptura(
    orderId: number,
    payload: RegisterRupturaDto
  ): Promise<OrderView> {
    const reason = String(
      payload.reason ?? "Ruptura de estoque identificada na prateleira fisica."
    ).trim();

    const order = await this.findOrder(orderId);

    const closedStatuses = new Set([
      "entregue_cliente",
      "retirado",
      "cancelado_ruptura",
      "cancelado_expirado",
      "cancelado",
    ]);
    if (closedStatuses.has(order.status)) {
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
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    if (order.store_id && order.product_id) {
      await this.storesService.registrarRupturaFisica(
        order.store_id,
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

    return this.findOrder(orderId);
  }

  /**
   * UC007 - Validar Retirada (Ator: Operador da Loja / Atendente)
   */
  async validatePickup(payload: ValidatePickupDto): Promise<OrderView> {
    const orderId = payload.order_id ? Number(payload.order_id) : null;
    const pickupCode = String(payload.pickup_code ?? "").trim();
    const cpfBusca = String(payload.cpf ?? "").trim();
    const isThirdParty = Boolean(payload.is_third_party ?? false);
    const documentChecked = Boolean(payload.document_checked ?? false);

    const supabase = this.supabaseService.client;
    let order: OrderView | null = null;

    if (orderId) {
      order = await this.getOrder(orderId);
    } else if (pickupCode) {
      const { data: row, error } = await supabase
        .from("orders")
        .select("id")
        .eq("pickup_code", pickupCode)
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(
          `Erro no banco de dados (Supabase): ${error.message}`
        );
      }
      if (row) {
        order = await this.getOrder(Number(row.id));
      }
    } else if (cpfBusca) {
      const { data: row, error } = await supabase
        .from("orders")
        .select("id")
        .or(`customer_cpf.eq.${cpfBusca},third_party_cpf.eq.${cpfBusca}`)
        .eq("status", "pronto_retirada")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(
          `Erro no banco de dados (Supabase): ${error.message}`
        );
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
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${updateErr.message}`
      );
    }

    const quemRetirou = isThirdParty
      ? `Terceiro autorizado (${order.third_party_name})`
      : `Titular (${order.customer_name})`;

    await this.createNotification(
      order.id,
      `Entrega presencial confirmada para ${quemRetirou}. Baixa final efetuada com sucesso.`
    );

    return this.findOrder(order.id);
  }

  /**
   * Regra de Abandono (7 dias): Cancela pedido não retirado e devolve estoque à filial.
   */
  async expireAbandonedOrder(orderId: number): Promise<OrderView> {
    const order = await this.findOrder(orderId);

    const closedStatuses = new Set([
      "entregue_cliente",
      "retirado",
      "cancelado_ruptura",
      "cancelado_expirado",
    ]);
    if (closedStatuses.has(order.status)) {
      throw new ConflictException("Pedido ja esta encerrado.");
    }

    const timestamp = this.nowIso();
    const supabase = this.supabaseService.client;
    const { error } = await supabase
      .from("orders")
      .update({
        status: "cancelado_expirado",
        cancellation_reason:
          "Prazo limite de comparecimento de 7 dias expirado.",
        refund_requested: 1,
        updated_at: timestamp,
      })
      .eq("id", orderId);

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    if (order.store_id && order.product_id) {
      await this.storesService.devolverEstoque(
        order.store_id,
        order.product_id,
        order.quantity
      );
    }

    await this.createNotification(
      orderId,
      "Pedido expirado por nao-comparecimento (7 dias). Item devolvido a prateleira e estorno acionado."
    );

    return this.findOrder(orderId);
  }

  async updateOrderStatus(
    orderId: number,
    payload: UpdateOrderStatusDto
  ): Promise<OrderView> {
    const newStatus = String(payload.status ?? "");

    const statusAliases: Record<string, string> = {
      aguardando_preparacao: "aguardando_separacao",
      retirado: "entregue_cliente",
      cancelado: "cancelado_expirado",
    };
    const normalizedStatus = statusAliases[newStatus] ?? newStatus;

    if (normalizedStatus === "pronto_retirada") {
      return this.separateOrder(orderId, payload);
    } else if (normalizedStatus === "cancelado_ruptura") {
      return this.registerRuptura(orderId, payload);
    } else if (normalizedStatus === "entregue_cliente") {
      return this.validatePickup({
        order_id: orderId,
        pickup_code: payload.pickup_code,
        document_checked: true,
        is_third_party: Boolean(payload.is_third_party ?? false),
      });
    } else if (normalizedStatus === "cancelado_expirado") {
      return this.expireAbandonedOrder(orderId);
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
        throw new InternalServerErrorException(
          `Erro no banco de dados (Supabase): ${error.message}`
        );
      }

      return this.findOrder(orderId);
    }
  }
}
