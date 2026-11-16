import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from "@nestjs/common";
import { StoreRow } from "../common/constants";
import { StoresService } from "./stores.service";

@Controller("api/stores")
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  async getStores(
    @Query("city") city?: string,
    @Query("product_id") productId?: string
  ): Promise<{ stores: StoreRow[] }> {
    const stores = await this.storesService.listStores(city, productId);
    return { stores };
  }

  // S3-25: de onde o item pode vir quando a filial escolhida não tem estoque.
  @Get(":id/transfer-options")
  async getTransferOptions(
    @Param("id") id: string,
    @Query("product_id") productId?: string,
    @Query("quantity") quantity?: string
  ) {
    const storeId = Number(id);
    const product = Number(productId);
    const qty = Number(quantity ?? 1);
    if (!Number.isInteger(storeId) || !Number.isInteger(product) || product < 1) {
      throw new BadRequestException("Informe o id da filial e o product_id.");
    }
    if (!Number.isInteger(qty) || qty < 1) {
      throw new BadRequestException("A quantidade deve ser maior que zero.");
    }
    const options = await this.storesService.listTransferOptions(
      storeId,
      product,
      qty
    );
    return { options };
  }
}
