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
  /** Descrição opcional do produto */
  description?: string | null;
  /**
   * Link de acesso ao produto entregue no e-mail pós-pagamento.
   * Pode ser URL de área de membros, drive, etc.
   */
  accessLink?: string | null;
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

export interface Order {
  id: string;
  offer_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_cpf: string;
  customer_phone: string;
  payment_method: PaymentMethod;
  status: OrderStatus;
  total_amount: number;
  access_delivered: boolean;
  created_at: string;
}

// ----------------------------------------------------------
// Contrato da API de Checkout
// ----------------------------------------------------------

export interface ProcessCheckoutRequest {
  offerId: string;
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

export interface ProcessCheckoutResponse {
  success: boolean;
  orderId: string;
  paymentMethod: PaymentMethod;
  productName: string;
  customerEmail: string;
  /** Código PIX Copia e Cola (somente para paymentMethod === 'pix') */
  pixCode?: string;
  /** URL do QR Code gerado (somente para paymentMethod === 'pix') */
  pixQrCodeUrl?: string;
  /** Mensagem de erro quando success === false */
  error?: string;
}
