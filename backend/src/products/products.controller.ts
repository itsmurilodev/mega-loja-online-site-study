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
  UseGuards,
} from "@nestjs/common";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { ProductRow } from "../common/constants";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import { ProductsService } from "./products.service";

@Controller("api/products")
@UseGuards(RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

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
    @Body() payload: CreateProductDto
  ): Promise<{ product: ProductRow }> {
    const product = await this.productsService.createProduct(payload ?? {});
    return { product };
  }

  // S3-08: a empresa troca imagem, preço e estoque de produtos existentes.
  @Patch(":id")
  @Roles("empresa")
  async updateProduct(
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
    return { product };
  }
}
