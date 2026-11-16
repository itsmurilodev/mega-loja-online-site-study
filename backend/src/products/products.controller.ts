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
import { ProductRow } from "../common/constants";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import { AuditService } from "../supabase/audit.service";
import { ProductsService } from "./products.service";

@Controller("api/products")
@UseGuards(RolesGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly auditService: AuditService
  ) {}

  @Get()
  async getProducts(
    @Query("store_id") storeId?: string,
    @Query("include") include?: string
  ): Promise<{ products: ProductRow[] }> {
    const products = await this.productsService.listProducts(
      storeId,
      include === "stock"
    );
    return { products };
  }

  // S3-08: a empresa cadastra produtos (com imagem e estoque por filial).
  @Post()
  @Roles("empresa")
  @HttpCode(HttpStatus.CREATED)
  async createProduct(
    @Req() request: { user: AuthUser },
    @Body() payload: CreateProductDto
  ): Promise<{ product: ProductRow }> {
    const product = await this.productsService.createProduct(payload ?? {});
    await this.auditService.record(
      request.user,
      "cadastrar_produto",
      null,
      `Produto #${product.id} ${product.name} (R$ ${product.price})`
    );
    return { product };
  }

  // S3-08: a empresa troca imagem, preço e estoque de produtos existentes.
  @Patch(":id")
  @Roles("empresa")
  async updateProduct(
    @Req() request: { user: AuthUser },
    @Param("id") id: string,
    @Body() payload: UpdateProductDto
  ): Promise<{ product: ProductRow }> {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException("ID invalido na URL.");
    }
    const product = await this.productsService.updateProduct(
      Number(id),
      payload ?? {}
    );
    await this.auditService.record(
      request.user,
      "alterar_produto",
      null,
      `Produto #${product.id} ${product.name}: ${Object.keys(payload ?? {}).join(", ")}`
    );
    return { product };
  }
}
