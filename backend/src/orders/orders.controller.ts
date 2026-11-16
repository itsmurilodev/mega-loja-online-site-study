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
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { NotificationRow, OrderView } from "../common/constants";
import {
  CheckoutDto,
  CreateOrderDto,
  RegisterRupturaDto,
  SeparateOrderDto,
  UpdateOrderStatusDto,
  ValidatePickupDto,
} from "./dto/order.dto";
import { OrdersService } from "./orders.service";

@Controller("api/orders")
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  private parseId(rawId: string): number {
    if (!/^\d+$/.test(rawId)) {
      throw new BadRequestException("ID invalido na URL.");
    }
    return Number(rawId);
  }

  // Fila de pedidos da filial: só operador e empresa (S3-14).
  @Get()
  @Roles("operador", "empresa")
  async listOrders(
    @Query("store_id") storeId?: string,
    @Query("status") status?: string
  ): Promise<{ orders: OrderView[] }> {
    const orders = await this.ordersService.listOrders(storeId, status);
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
  @Roles("operador", "empresa")
  @HttpCode(HttpStatus.OK)
  async validatePickup(
    @Body() payload: ValidatePickupDto
  ): Promise<{ order: OrderView }> {
    const order = await this.ordersService.validatePickup(payload ?? {});
    return { order };
  }

  // Alias de compatibilidade para UC007
  @Post("pickup")
  @Roles("operador", "empresa")
  @HttpCode(HttpStatus.OK)
  async validatePickupAlias(
    @Body() payload: ValidatePickupDto
  ): Promise<{ order: OrderView }> {
    const order = await this.ordersService.validatePickup(payload ?? {});
    return { order };
  }

  @Get(":id/notifications")
  async getNotifications(
    @Param("id") id: string
  ): Promise<{ notifications: NotificationRow[] }> {
    const orderId = this.parseId(id);
    const notifications = await this.ordersService.listNotifications(orderId);
    return { notifications };
  }

  @Get(":id")
  async getOrder(@Param("id") id: string): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.findOrder(orderId);
    return { order };
  }

  // UC005: Separar Pedido (com leitura de código de barras / SKU)
  @Post(":id/separate")
  @Roles("operador", "empresa")
  @HttpCode(HttpStatus.OK)
  async separateOrder(
    @Param("id") id: string,
    @Body() payload: SeparateOrderDto
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.separateOrder(
      orderId,
      payload ?? {}
    );
    return { order };
  }

  // UC008: Registrar Ruptura (Falta de Item na Prateleira)
  @Post(":id/rupture")
  @Roles("operador", "empresa")
  @HttpCode(HttpStatus.OK)
  async registerRuptura(
    @Param("id") id: string,
    @Body() payload: RegisterRupturaDto
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.registerRuptura(
      orderId,
      payload ?? {}
    );
    return { order };
  }

  // Regra de Abandono (7 dias)
  @Post(":id/expire")
  @Roles("operador", "empresa")
  @HttpCode(HttpStatus.OK)
  async expireOrder(@Param("id") id: string): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.expireAbandonedOrder(orderId);
    return { order };
  }

  @Patch(":id/status")
  @Roles("operador", "empresa")
  async updateStatus(
    @Param("id") id: string,
    @Body() payload: UpdateOrderStatusDto
  ): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.updateOrderStatus(
      orderId,
      payload ?? {}
    );
    return { order };
  }
}
