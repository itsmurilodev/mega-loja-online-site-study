import { Controller, Get, Query } from "@nestjs/common";
import { ProductRow } from "../common/constants";
import { ProductsService } from "./products.service";

@Controller("api/products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getProducts(
    @Query("store_id") storeId?: string
  ): Promise<{ products: ProductRow[] }> {
    const products = await this.productsService.listProducts(storeId);
    return { products };
  }
}
