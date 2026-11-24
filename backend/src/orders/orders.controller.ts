import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  NotFoundException,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { AuthUser, STAFF_ROLES } from "../auth/auth.types";
import { extractBearerToken, Roles, RolesGuard } from "../auth/roles.guard";
import { NotificationRow, OrderView } from "../common/constants";
import { AuditEntry, AuditService } from "../supabase/audit.service";
import {
  CheckoutDto,
  CreateOrderDto,
  RegisterRupturaDto,
  SeparateOrderDto,
  ThirdPartyCodeDto,
  UpdateOrderStatusDto,
  ValidatePickupDto,
} from "./dto/order.dto";
import { OrderAccessService } from "./order-access.service";
import { OrdersService } from "./orders.service";
import {
  ThirdPartyCodeResult,
  ThirdPartyCodeService,
} from "./third-party-code.service";

@Controller("api/orders")
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly thirdPartyCodeService: ThirdPartyCodeService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    private readonly orderAccess: OrderAccessService
  ) {}

  private parseId(rawId: string): number {
    if (!/^\d+$/.test(rawId)) {
      throw new BadRequestException("ID invalido na URL.");
    }
    return Number(rawId);
  }

  /**
   * Privacidade: ler um pedido (nome, CPF, voucher, notificações) exige ser
   * colaborador, o cliente dono do pedido (login com o mesmo CPF) ou ter a chave
   * de acesso que a compra devolveu (cabeçalho X-Order-Token). Sem nada disso: 401.
   * Quem tem login mas não é dono recebe 404, para não revelar que o pedido existe.
   */
  private async authorizeOrderRead(
    request: { headers?: Record<string, string | string[] | undefined> },
    orderId: number
  ): Promise<void> {
    const rawKey = request.headers?.["x-order-token"];
    const chave = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (chave && this.orderAccess.isValid(orderId, chave)) {
      return;
    }

    const bearer = extractBearerToken(
      request.headers?.authorization as string | undefined
    );
    if (!bearer) {
      throw new UnauthorizedException(
        "Faça login ou use o acesso do pedido para ver os detalhes."
      );
    }
    const user = await this.authService.verifyToken(bearer);
    if (STAFF_ROLES.includes(user.role)) {
      return;
    }
    if (user.role === "cliente" && user.cpf) {
      const pedido = await this.ordersService.findOrder(orderId);
      const digitos = (v: string | null) => (v ?? "").replace(/D/g, "");
      if (
        digitos(pedido.customer_cpf) !== "" &&
        digitos(pedido.customer_cpf) === digitos(user.cpf)
      ) {
        return;
      }
    }
    throw new NotFoundException("Pedido nao encontrado.");
  }

  // Fila de pedidos da filial: só operador, gerente e empresa (S3-14 / S3-16).
  @Get()
  @Roles("operador", "gerente", "empresa")
  async listOrders(
    @Query("store_id") storeId?: string,
    @Query("status") status?: string,
    @Query("include") include?: string
  ): Promise<{ orders: OrderView[] }> {
    // S3-20: itens com entrega não passam pelo balcão (include=entrega mostra tudo).
    const orders = await this.ordersService.listOrders(
      storeId,
      status,
      include === "entrega"
    );
    return { orders };
  }

  // Pedidos do cliente logado (portal do cliente).
  @Get("mine")
  @Roles("cliente")
  async myOrders(@Req() request: { user: AuthUser }): Promise<{ orders: OrderView[] }> {
    const cpf = request.user.cpf;
    if (!cpf) {
      return { orders: [] };
    }
    return { orders: await this.ordersService.listOrdersByCpf(cpf) };
  }

  // S3-22: janelas de retirada do dia e quantos pedidos já ocupam cada uma.
  @Get("pickup-slots")
  async pickupSlots(
    @Query("store_id") storeId?: string,
    @Query("date") date?: string
  ) {
    if (!storeId || !/^\d+$/.test(storeId)) {
      throw new BadRequestException("Informe o store_id.");
    }
    return this.ordersService.listPickupSlots(Number(storeId), date);
  }

  // S3-18: pede o código de confirmação para indicar um terceiro (envio simulado).
  @Post("third-party-code")
  @HttpCode(HttpStatus.CREATED)
  thirdPartyCode(
    @Body() payload: ThirdPartyCodeDto
  ): { confirmation: ThirdPartyCodeResult } {
    return { confirmation: this.thirdPartyCodeService.issue(payload ?? {}) };
  }

  // S3-23: total a pagar (itens + frete simulado), usado para gerar o Pix.
  @Post("quote")
  @HttpCode(HttpStatus.OK)
  async quote(@Body() payload: CheckoutDto) {
    return this.ordersService.quote(payload ?? {});
  }

  // S3-24: libera as reservas vencidas (gerente/empresa; também roda sozinho com RESERVA_AUTO_EXPIRAR=true).
  @Post("expire-overdue")
  @Roles("gerente", "empresa")
  @HttpCode(HttpStatus.OK)
  async expireOverdue(
    @Req() request: { user: AuthUser },
    @Query("order_id") orderId?: string,
    @Query("hours") hours?: string
  ) {
    if (orderId !== undefined && !/^\d+$/.test(orderId)) {
      throw new BadRequestException("order_id invalido.");
    }
    if (hours !== undefined && hours !== "" && Number.isNaN(Number(hours))) {
      throw new BadRequestException("hours invalido.");
    }
    return this.ordersService.expireOverdue(
      {
        orderId: orderId ? Number(orderId) : null,
        hours: hours !== undefined && hours !== "" ? Number(hours) : null,
      },
      request.user
    );
  }

  // UC003: Finalizar Compra (cliente não precisa de login de operador)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Body() payload: CreateOrderDto
  ): Promise<{ order: OrderView }> {
    const order = await this.ordersService.createOrder(payload ?? {});
    return { order };
  }

  // S3-15: Finalizar compra com carrinho de vários itens
  @Post("checkout")
  @HttpCode(HttpStatus.CREATED)
  async checkout(
    @Body() payload: CheckoutDto
  ): Promise<{ orders: OrderView[] }> {
    const orders = await this.ordersService.createCheckout(payload ?? {});
    return { orders };
  }

  // UC007: Validar Retirada Presencial
  @Post("validate-pickup")
  @Roles("operador", "gerente", "empresa")
  @HttpCode(HttpStatus.OK)
  async validatePickup(
    @Req() request: { user: AuthUser },
    @Body() payload: ValidatePickupDto
  ): Promise<{ order: OrderView }> {
    const order = await this.ordersService.validatePickup(
      payload ?? {},
      request.user
    );
    return { order };
  }

  // Alias de compatibilidade para UC007
  @Post("pickup")
  @Roles("operador", "gerente", "empresa")
  @HttpCode(HttpStatus.OK)
  async validatePickupAlias(
    @Req() request: { user: AuthUser },
    @Body() payload: ValidatePickupDto
  ): Promise<{ order: OrderView }> {
    const order = await this.ordersService.validatePickup(
      payload ?? {},
      request.user
    );
    return { order };
  }

  @Get(":id/notifications")
  async getNotifications(
    @Req() request: { headers: Record<string, string> },
    @Param("id") id: string
  ): Promise<{ notifications: NotificationRow[] }> {
    const orderId = this.parseId(id);
    await this.authorizeOrderRead(request, orderId);
    const notifications = await this.ordersService.listNotifications(orderId);
    return { notifications };
  }

  // S3-17: histórico de ações dos operadores neste pedido.
  @Get(":id/audit")
  @Roles("operador", "gerente", "empresa")
  async getAudit(@Param("id") id: string): Promise<{ audit: AuditEntry[] }> {
    const orderId = this.parseId(id);
    return { audit: await this.auditService.list({ orderId }) };
  }

  @Get(":id")
  async getOrder(
    @Req() request: { headers: Record<string, string> },
    @Param("id") id: string
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    await this.authorizeOrderRead(request, orderId);
    const order = await this.ordersService.findOrder(orderId);
    return { order };
  }

  // UC005: Separar Pedido (com leitura de código de barras / SKU)
  @Post(":id/separate")
  @Roles("operador", "gerente", "empresa")
  @HttpCode(HttpStatus.OK)
  async separateOrder(
    @Req() request: { user: AuthUser },
    @Param("id") id: string,
    @Body() payload: SeparateOrderDto
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.separateOrder(
      orderId,
      payload ?? {},
      request.user
    );
    return { order };
  }

  // UC008: Registrar Ruptura (Falta de Item na Prateleira)
  @Post(":id/rupture")
  @Roles("operador", "gerente", "empresa")
  @HttpCode(HttpStatus.OK)
  async registerRuptura(
    @Req() request: { user: AuthUser },
    @Param("id") id: string,
    @Body() payload: RegisterRupturaDto
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.registerRuptura(
      orderId,
      payload ?? {},
      request.user
    );
    return { order };
  }

  // Regra de Abandono (7 dias). S3-16: cancelar pedido é com gerente/empresa.
  @Post(":id/expire")
  @Roles("gerente", "empresa")
  @HttpCode(HttpStatus.OK)
  async expireOrder(
    @Req() request: { user: AuthUser },
    @Param("id") id: string
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.expireAbandonedOrder(
      orderId,
      request.user
    );
    return { order };
  }

  @Patch(":id/status")
  @Roles("operador", "gerente", "empresa")
  async updateStatus(
    @Req() request: { user: AuthUser },
    @Param("id") id: string,
    @Body() payload: UpdateOrderStatusDto
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.updateOrderStatus(
      orderId,
      payload ?? {},
      request.user
    );
    return { order };
  }
}
