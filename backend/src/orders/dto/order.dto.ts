export interface CreateOrderDto {
  customer_name?: string;
  customer_cpf?: string;
  delivery_method?: string;
  store_id?: number;
  product_id?: number;
  quantity?: number;
  card_number?: string;
  simulate_payment_failure?: boolean;
  third_party_name?: string | null;
  third_party_cpf?: string | null;
}

export interface SeparateOrderDto {
  barcode_or_sku?: string;
}

export interface RegisterRupturaDto {
  reason?: string;
}

export interface ValidatePickupDto {
  order_id?: number;
  pickup_code?: string;
  cpf?: string;
  is_third_party?: boolean;
  document_checked?: boolean;
}

export interface UpdateOrderStatusDto {
  status?: string;
  barcode_or_sku?: string;
  reason?: string;
  pickup_code?: string;
  is_third_party?: boolean;
}
