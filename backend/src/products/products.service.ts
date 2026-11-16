import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { ProductRow } from "../common/constants";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import { RnfMetricsService } from "../common/metrics/rnf-metrics.service";
import { SupabaseService } from "../supabase/supabase.service";

@Injectable()
export class ProductsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly rnfMetricsService: RnfMetricsService
  ) {}

  async listProducts(
    storeId?: string | number | null,
    includeAllStocks = false
  ): Promise<ProductRow[]> {
    const start = performance.now();
    const supabase = this.supabaseService.client;

    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, category, price, image_url, sku, barcode")
      .order("name", { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    const productList: ProductRow[] = (products ?? []).map((p: any) => ({
      id: Number(p.id),
      name: p.name,
      category: p.category,
      price: Number(p.price),
      image_url: p.image_url ?? null,
      sku: p.sku ?? null,
      barcode: p.barcode ?? null,
    }));

    if (storeId !== undefined && storeId !== null && storeId !== "") {
      const parsedStoreId = Number(storeId);
      const { data: invRows, error: invErr } = await supabase
        .from("inventory")
        .select("product_id, quantity")
        .eq("store_id", parsedStoreId);

      if (invErr) {
        throw new InternalServerErrorException(
          `Erro no banco de dados (Supabase): ${invErr.message}`
        );
      }

      const stockByProduct = new Map<number, number>();
      for (const row of invRows ?? []) {
        stockByProduct.set(Number(row.product_id), Number(row.quantity));
      }

      const result = productList.map((product) => ({
        ...product,
        stock: stockByProduct.get(product.id) ?? 0,
      }));

      this.rnfMetricsService.record(
        "consulta_estoque",
        "listProductsWithStock",
        performance.now() - start,
        { store_id: parsedStoreId }
      );

      return result;
    }

    if (includeAllStocks) {
      // Uma única consulta traz o estoque de todas as filiais (evita N chamadas).
      const stocks = await this.loadAllStocks();
      for (const product of productList) {
        product.stocks = stocks.get(product.id) ?? {};
      }
    }

    this.rnfMetricsService.record(
      "consulta_estoque",
      "listProductsCatalog",
      performance.now() - start
    );

    return productList;
  }

  private async loadAllStocks(): Promise<Map<number, Record<number, number>>> {
    const { data, error } = await this.supabaseService.client
      .from("inventory")
      .select("store_id, product_id, quantity");
    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
    const byProduct = new Map<number, Record<number, number>>();
    for (const row of data ?? []) {
      const productId = Number(row.product_id);
      const stocks = byProduct.get(productId) ?? {};
      stocks[Number(row.store_id)] = Number(row.quantity);
      byProduct.set(productId, stocks);
    }
    return byProduct;
  }

  // ---------------------------------------------------------------------------
  // S3-08 - Cadastro e edição de produtos (perfil empresa)
  // ---------------------------------------------------------------------------

  private cleanText(value: unknown): string {
    return String(value ?? "").trim();
  }

  private parsePrice(value: unknown): number {
    const normalized =
      typeof value === "string" ? value.replace(",", ".").trim() : value;
    const price = Number(normalized);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException("O preço deve ser um número maior que zero.");
    }
    return Math.round(price * 100) / 100;
  }

  private validateImageUrl(value: string): string | null {
    if (!value) return null;
    if (!/^https?:\/\/\S+$/i.test(value)) {
      throw new BadRequestException(
        "A imagem deve ser um link http(s) válido (ex.: https://...)."
      );
    }
    return value;
  }

  private async assertSkuAvailable(
    sku: string,
    ignoreProductId?: number
  ): Promise<void> {
    if (!sku) return;
    const { data, error } = await this.supabaseService.client
      .from("products")
      .select("id")
      .eq("sku", sku);
    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
    const conflict = (data ?? []).some((row) => Number(row.id) !== ignoreProductId);
    if (conflict) {
      throw new ConflictException(`Já existe um produto com o SKU '${sku}'.`);
    }
  }

  private async parseStockMap(
    stock: Record<string, number | string> | undefined
  ): Promise<{ store_id: number; quantity: number }[]> {
    if (!stock || typeof stock !== "object") return [];
    const rows: { store_id: number; quantity: number }[] = [];
    for (const [rawStoreId, rawQuantity] of Object.entries(stock)) {
      if (rawQuantity === "" || rawQuantity === null || rawQuantity === undefined) {
        continue;
      }
      const storeId = Number(rawStoreId);
      const quantity = Number(rawQuantity);
      if (!Number.isInteger(storeId) || storeId < 1) {
        throw new BadRequestException("Filial inválida no estoque informado.");
      }
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new BadRequestException(
          "O estoque deve ser um número inteiro maior ou igual a zero."
        );
      }
      rows.push({ store_id: storeId, quantity });
    }

    if (rows.length > 0) {
      const { data, error } = await this.supabaseService.client
        .from("stores")
        .select("id")
        .in(
          "id",
          rows.map((row) => row.store_id)
        );
      if (error) {
        throw new InternalServerErrorException(
          `Erro no banco de dados (Supabase): ${error.message}`
        );
      }
      const known = new Set((data ?? []).map((row) => Number(row.id)));
      const unknown = rows.find((row) => !known.has(row.store_id));
      if (unknown) {
        throw new BadRequestException(`Filial ${unknown.store_id} não existe.`);
      }
    }
    return rows;
  }

  private async saveStocks(
    productId: number,
    rows: { store_id: number; quantity: number }[]
  ): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.supabaseService.client.from("inventory").upsert(
      rows.map((row) => ({ ...row, product_id: productId })),
      { onConflict: "store_id,product_id" }
    );
    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
  }

  async createProduct(payload: CreateProductDto): Promise<ProductRow> {
    const name = this.cleanText(payload.name);
    const category = this.cleanText(payload.category);
    const sku = this.cleanText(payload.sku);
    const barcode = this.cleanText(payload.barcode);
    const imageUrl = this.validateImageUrl(this.cleanText(payload.image_url));

    if (!name) throw new BadRequestException("Informe o nome do produto.");
    if (!category) throw new BadRequestException("Informe a categoria.");
    if (!sku) throw new BadRequestException("Informe o SKU do produto.");
    const price = this.parsePrice(payload.price);

    await this.assertSkuAvailable(sku);
    const stockRows = await this.parseStockMap(payload.stock);

    const supabase = this.supabaseService.client;
    const { data: last, error: lastErr } = await supabase
      .from("products")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);
    if (lastErr) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${lastErr.message}`
      );
    }
    const nextId = (last?.[0] ? Number(last[0].id) : 0) + 1;

    const { error } = await supabase.from("products").insert({
      id: nextId,
      name,
      category,
      price,
      image_url: imageUrl,
      sku,
      barcode: barcode || null,
    });
    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    await this.saveStocks(nextId, stockRows);
    return this.getProductWithStocks(nextId);
  }

  async updateProduct(
    productId: number,
    payload: UpdateProductDto
  ): Promise<ProductRow> {
    await this.getProductWithStocks(productId); // 404 se não existir

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) {
      const name = this.cleanText(payload.name);
      if (!name) throw new BadRequestException("O nome não pode ficar vazio.");
      changes.name = name;
    }
    if (payload.category !== undefined) {
      const category = this.cleanText(payload.category);
      if (!category) throw new BadRequestException("A categoria não pode ficar vazia.");
      changes.category = category;
    }
    if (payload.price !== undefined) {
      changes.price = this.parsePrice(payload.price);
    }
    if (payload.sku !== undefined) {
      const sku = this.cleanText(payload.sku);
      if (!sku) throw new BadRequestException("O SKU não pode ficar vazio.");
      await this.assertSkuAvailable(sku, productId);
      changes.sku = sku;
    }
    if (payload.barcode !== undefined) {
      changes.barcode = this.cleanText(payload.barcode) || null;
    }
    if (payload.image_url !== undefined) {
      changes.image_url = this.validateImageUrl(this.cleanText(payload.image_url));
    }
    const stockRows = await this.parseStockMap(payload.stock);

    if (Object.keys(changes).length > 0) {
      const { error } = await this.supabaseService.client
        .from("products")
        .update(changes)
        .eq("id", productId);
      if (error) {
        throw new InternalServerErrorException(
          `Erro no banco de dados (Supabase): ${error.message}`
        );
      }
    }

    await this.saveStocks(productId, stockRows);
    return this.getProductWithStocks(productId);
  }

  private async getProductWithStocks(productId: number): Promise<ProductRow> {
    const { data, error } = await this.supabaseService.client
      .from("products")
      .select("id, name, category, price, image_url, sku, barcode")
      .eq("id", productId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }
    if (!data) {
      throw new NotFoundException("Produto nao encontrado no catalogo.");
    }
    const stocks = (await this.loadAllStocks()).get(productId) ?? {};
    return {
      id: Number(data.id),
      name: data.name,
      category: data.category,
      price: Number(data.price),
      image_url: data.image_url ?? null,
      sku: data.sku ?? null,
      barcode: data.barcode ?? null,
      stocks,
    };
  }

  async findProductById(
    productId: number
  ): Promise<{
    id: number;
    name: string;
    price: number;
    image_url: string | null;
  } | null> {
    const supabase = this.supabaseService.client;
    const { data, error } = await supabase
      .from("products")
      .select("id, name, price, image_url")
      .eq("id", productId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Erro no banco de dados (Supabase): ${error.message}`
      );
    }

    return data
      ? {
          id: Number(data.id),
          name: data.name,
          price: Number(data.price),
          image_url: data.image_url ?? null,
        }
      : null;
  }
}
