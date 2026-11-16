/** S3-23: um meio de pagamento (cartão ou Pix) de uma compra. */
export interface PaymentMethodDto {
  type?: "cartao" | "pix";
  /** Valor pago neste meio. Com um meio só, pode ser omitido (vale o total). */
  amount?: number;
  card_number?: string;
  simulate_failure?: boolean;
  /** Token devolvido por POST /api/payments/pix. */
  pix_token?: string;
}

/** Campos comuns a qualquer compra (um item ou carrinho). */
interface CompraBaseDto {
  customer_name?: string;
  customer_cpf?: string;
  delivery_method?: string;
  store_id?: number;
  card_number?: string;
  simulate_payment_failure?: boolean;
  third_party_name?: string | null;
  third_party_cpf?: string | null;
  /** S3-18: código de 6 dígitos de POST /api/orders/third-party-code. */
  third_party_code?: string | null;
  /** S3-22: janela de retirada (AAAA-MM-DDTHH:00). */
  pickup_slot?: string | null;
  /** S3-20: endereço dos itens com entrega. */
  shipping_address?: string | null;
  /** S3-23: dividir ou trocar o meio de pagamento (padrão: um cartão). */
  payment?: { methods?: PaymentMethodDto[] };
}

export interface CreateOrderDto extends CompraBaseDto {
  product_id?: number;
  quantity?: number;
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

export interface CheckoutItemDto {
  product_id?: number;
  quantity?: number;
  /** S3-20: retirar na loja ou receber em casa, por item. */
  delivery?: string;
  /** S3-25: loja/CD de onde o item é transferido (só retirada na loja). */
  transfer_from?: number | null;
}

/** S3-15: checkout do carrinho com vários itens. */
export interface CheckoutDto extends CompraBaseDto {
  items?: CheckoutItemDto[];
}

export interface ThirdPartyCodeDto {
  customer_cpf?: string;
  third_party_cpf?: string;
  email?: string;
}
