import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { StoreRow } from "../common/constants";
import { RnfMetricsService } from "../common/metrics/rnf-metrics.service";
import { SupabaseService } from "../supabase/supabase.service";

/**
 * Serviço de Lojas e Sistema de Estoque (Ator 3 - S.E. no padrão BCE)
 * Monitora a disponibilidade por loja física em tempo real (UC002) com medição de SLA do RNF001 (<= 60s).
 */
@Injectable()
export class StoresService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly rnfMetricsService: RnfMetricsService
  ) {}

  async listStores(
    city?: string | null,
    productId?: string | number | null
  ): Promise<StoreRow[]> {
    const start = performance.now();
    const supabase = this.supabaseService.client;

    let query = supabase
      .from("stores")
      .select("id, name, city, zip_code, address, capacity, active")
      .eq("active", 1);

    if (city) {
      query = query.ilike("city", `%${city}%`);
    }

    const { data: stores, error } = await query
      .order("city", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    const storeList: StoreRow[] = (stores ?? []).map((s: any) => ({
      id: Number(s.id),
      name: s.name,
      city: s.city,
      zip_code: s.zip_code,
      address: s.address,
      capacity: Number(s.capacity),
      active: Number(s.active),
    }));

    if (productId !== undefined && productId !== null && productId !== "") {
      const parsedProductId = Number(productId);
      const { data: invRows, error: invErr } = await supabase
        .from("inventory")
        .select("store_id, quantity")
        .eq("product_id", parsedProductId);

      if (invErr) {
        throw new InternalServerErrorException(
          `Erro no banco de dados (Supabase): ${invErr.message}`
        );
      }

      const stockByStore = new Map<number, number>();
      for (const row of invRows ?? []) {
        stockByStore.set(Number(row.store_id), Number(row.quantity));
      }

      const result = storeList.map((store) => ({
        ...store,
        stock: stockByStore.get(store.id) ?? 0,
      }));

      this.rnfMetricsService.record(
        "consulta_estoque",
        "listStoresWithStock",
        performance.now() - start,
        { product_id: parsedProductId, city: city ?? null }
      );

      return result;
    }

    return storeList;
  }

  async findActiveStoreById(
    storeId: number
  ): Promise<{ id: number; name: string } | null> {
    const supabase = this.supabaseService.client;
    const { data, error } = await supabase
      .from("stores")
      .select("id, name")
      .eq("id", storeId)
      .eq("active", 1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
    return data ? { id: Number(data.id), name: data.name } : null;
  }

  /**
   * UC002 - Consultar Disponibilidade de Estoque em Tempo Real (medido pelo RNF001 <= 60s)
   */
  async consultarDisponibilidade(
    storeId: number,
    productId: number,
    quantity: number
  ): Promise<{ disponivel: boolean; available: number; duration_ms: number }> {
    const start = performance.now();
    const supabase = this.supabaseService.client;
    const { data, error } = await supabase
      .from("inventory")
      .select("quantity")
      .eq("store_id", storeId)
      .eq("product_id", productId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    const available = data ? Number(data.quantity) : 0;
    const disponivel = available >= quantity;
    const measurement = this.rnfMetricsService.record(
      "consulta_estoque",
      "UC002_consultarDisponibilidade",
      performance.now() - start,
      { store_id: storeId, product_id: productId, quantity, available, disponivel }
    );

    return {
      disponivel,
      available,
      duration_ms: measurement.duration_ms,
    };
  }

  /**
   * Reserva de estoque na filial (medido pelo RNF001 <= 60s)
   */
  async reservarEstoque(
    storeId: number,
    productId: number,
    quantity: number
  ): Promise<{ duration_ms: number }> {
    const start = performance.now();
    const { available } = await this.consultarDisponibilidade(
      storeId,
      productId,
      quantity
    );
    const supabase = this.supabaseService.client;
    const { error } = await supabase
      .from("inventory")
      .update({ quantity: Math.max(0, available - quantity) })
      .eq("store_id", storeId)
      .eq("product_id", productId);

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    const measurement = this.rnfMetricsService.record(
      "reserva_estoque",
      "UC003_reservarEstoque",
      performance.now() - start,
      { store_id: storeId, product_id: productId, quantity }
    );

    return { duration_ms: measurement.duration_ms };
  }

  async devolverEstoque(
    storeId: number,
    productId: number,
    quantity: number
  ): Promise<void> {
    const { available } = await this.consultarDisponibilidade(
      storeId,
      productId,
      0
    );
    const supabase = this.supabaseService.client;
    const { error } = await supabase
      .from("inventory")
      .update({ quantity: available + quantity })
      .eq("store_id", storeId)
      .eq("product_id", productId);

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
  }

  async registrarRupturaFisica(
    storeId: number,
    productId: number
  ): Promise<void> {
    const supabase = this.supabaseService.client;
    const { error } = await supabase
      .from("inventory")
      .update({ quantity: 0 })
      .eq("store_id", storeId)
      .eq("product_id", productId);

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
  }
}
