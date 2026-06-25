// ============================================================
// SmartCheckout Engine — Tipos centrais da aplicação
// ============================================================

// ----------------------------------------------------------
// Oferta (espelha a tabela 'offers' do Supabase compartilhado)
// ----------------------------------------------------------

export interface OfferMetadata {
  /** Nome do produto exibido no checkout e no e-mail de entrega */
  productName: string;
  /** Preço cobrado em BRL (ex: 97.00) */
  price: number;
  /** Pixel ID da Meta usado dinamicamente por oferta */
  meta_pixel_id?: string | null;
  /** Access Token da Conversion API usado dinamicamente por oferta */
  meta_access_token?: string | null;
  /** Descrição opcional do produto */
  description?: string | null;
  /**
   * Link de download/acesso do produto no metadata.
   */
  productDownloadUrl?: string | null;
  /** Imagem de capa opcional do produto */
  imageUrl?: string | null;
}

export interface Offer {
  id: string;
  metadata: OfferMetadata;
  created_at: string;
}

// ----------------------------------------------------------
// Pedido (espelha a tabela 'orders' criada pela migration)
// ----------------------------------------------------------

export type PaymentMethod = 'pix' | 'credit_card';
export type OrderStatus   = 'pending' | 'paid' | 'refused';

export interface TrackingParams {
  utm_source?: string | null;
  utm_campaign?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  fbclid?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

export interface Order {
  id: string;
  offer_id: string | null;
  payment_provider: string | null;
  external_transaction_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_cpf: string;
  customer_phone: string;
  payment_method: PaymentMethod;
  status: OrderStatus;
  total_amount: number;
  meta_pixel_id?: string | null;
  meta_access_token?: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  fbclid?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  client_ip?: string | null;
  client_user_agent?: string | null;
  access_delivered: boolean;
  gateway_payload?: Record<string, unknown> | null;
  created_at: string;
}

// ----------------------------------------------------------
// Contrato da API de Checkout
// ----------------------------------------------------------

export interface ProcessCheckoutRequest extends TrackingParams {
  offerId: string;
  /** Optional server-created order id from step 1 (initiate) */
  orderId?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCpf: string;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  // Cartão de crédito (opcional)
  cardNumber?: string;
  cardName?: string;
  cardExpiry?: string;
  cardCvv?: string;
  installments?: number;
}

export interface MetaCapiOrderData extends TrackingParams {
  id: string;
  created_at?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_cpf?: string | null;
  total_amount?: number | null;
  product_name?: string | null;
  client_ip?: string | null;
  client_user_agent?: string | null;
}

export interface ProcessCheckoutResponse {
  success: boolean;
  orderId: string;
  paymentMethod: PaymentMethod;
  paymentStatus?: OrderStatus;
  transactionId?: string;
  productName: string;
  customerEmail: string;
  /** Código PIX Copia e Cola (somente para paymentMethod === 'pix') */
  pixCode?: string;
  /** URL do QR Code gerado (somente para paymentMethod === 'pix') */
  pixQrCodeUrl?: string;
  /** Mensagem de erro quando success === false */
  error?: string;
}
