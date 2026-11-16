export interface CreateProductDto {
  name?: string;
  category?: string;
  price?: number | string;
  sku?: string;
  barcode?: string;
  image_url?: string;
  /** Estoque por filial: { "1": 10, "2": 4 } (id da filial -> quantidade). */
  stock?: Record<string, number | string>;
}

export type UpdateProductDto = CreateProductDto;
