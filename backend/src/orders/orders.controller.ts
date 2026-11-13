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
} from "@nestjs/common";
import { NotificationRow, OrderView } from "../common/constants";
import {
  CreateOrderDto,
  RegisterRupturaDto,
  SeparateOrderDto,
  UpdateOrderStatusDto,
  ValidatePickupDto,
} from "./dto/order.dto";
import { OrdersService } from "./orders.service";

@Controller("api/orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  private parseId(rawId: string): number {
    if (!/^\d+$/.test(rawId)) {
      throw new BadRequestException("ID invalido na URL.");
    }
    return Number(rawId);
  }

  @Get()
  async listOrders(
    @Query("store_id") storeId?: string,
    @Query("status") status?: string
  ): Promise<{ orders: OrderView[] }> {
    const orders = await this.ordersService.listOrders(storeId, status);
    return { orders };
  }

  // UC003: Finalizar Compra
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Body() payload: CreateOrderDto
  ): Promise<{ order: OrderView }> {
    const order = await this.ordersService.createOrder(payload ?? {});
    return { order };
  }

  // UC007: Validar Retirada Presencial
  @Post("validate-pickup")
  @HttpCode(HttpStatus.OK)
  async validatePickup(
    @Body() payload: ValidatePickupDto
  ): Promise<{ order: OrderView }> {
    const order = await this.ordersService.validatePickup(payload ?? {});
    return { order };
  }

  // Alias de compatibilidade para UC007
  @Post("pickup")
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
  @HttpCode(HttpStatus.OK)
  async expireOrder(@Param("id") id: string): Promise<{ order: OrderView }> {
    const orderId = this.parseId(id);
    const order = await this.ordersService.expireAbandonedOrder(orderId);
    return { order };
  }

  @Patch(":id/status")
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
