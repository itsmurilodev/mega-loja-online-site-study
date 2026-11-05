import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ProductRow } from "../common/constants";
import { SupabaseService } from "../supabase/supabase.service";

@Injectable()
export class ProductsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async listProducts(storeId?: string | number | null): Promise<ProductRow[]> {
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

      return productList.map((product) => ({
        ...product,
        stock: stockByProduct.get(product.id) ?? 0,
      }));
    }

    return productList;
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
