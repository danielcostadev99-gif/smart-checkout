export interface CustomerInput {
  name: string;
  email: string;
  cpf: string;
  phone: string;
}

export interface PaymentRequest {
  orderId: string;
  amount: number;
  description: string;
  customer: CustomerInput;
  paymentMethod: 'pix' | 'credit_card';
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
    installments: number;
  };
}

export interface PaymentResponse {
  success: boolean;
  status: 'paid' | 'pending' | 'refused';
  transactionId: string;
  pixCopiaECola?: string;
  pixQrCodeBase64?: string;
  errorMessage?: string;
}

export type PaymentProvider = 'asaas' | 'appmax';
