import { Controller, Get, Query } from "@nestjs/common";
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
}
