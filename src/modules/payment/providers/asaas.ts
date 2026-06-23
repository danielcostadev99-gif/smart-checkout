import type {
  PaymentRequest,
  PaymentResponse,
} from '@/src/modules/payment/types';

type AsaasCustomerResponse = {
  id: string;
};

type AsaasPaymentResponse = {
  id: string;
  status?: string;
};

type AsaasPixQrResponse = {
  encodedImage?: string;
  payload?: string;
};

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function mapAsaasStatus(status: string | undefined): 'paid' | 'pending' | 'refused' {
  if (!status) {
    return 'pending';
  }

  const normalized = status.toUpperCase();

  if (normalized === 'RECEIVED' || normalized === 'CONFIRMED' || normalized === 'RECEIVED_IN_CASH') {
    return 'paid';
  }

  if (
    normalized === 'PENDING'
    || normalized === 'AWAITING_RISK_ANALYSIS'
    || normalized === 'OVERDUE'
    || normalized === 'AWAITING_CHARGEBACK_REVERSAL'
  ) {
    return 'pending';
  }

  return 'refused';
}

async function asaasFetch<T>(path: string, payload?: unknown): Promise<T> {
  const apiKey = process.env.GATEWAY_API_KEY;

  if (!apiKey) {
    throw new Error('GATEWAY_API_KEY nao configurada para o provider Asaas.');
  }

  const base = (process.env.ASAAS_BASE_URL?.trim() || 'https://api.asaas.com').replace(/\/+$/, '');
  const endpoint = `${base}/v3${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(endpoint, {
    method: payload ? 'POST' : 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      access_token: apiKey,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errorText = typeof json.errors === 'string'
      ? json.errors
      : typeof json.message === 'string'
        ? json.message
        : `Erro HTTP ${response.status} no Asaas`;

    throw new Error(errorText);
  }

  return json as T;
}

async function createAsaasCustomer(req: PaymentRequest): Promise<string> {
  const customerPayload = {
    name: req.customer.name,
    email: req.customer.email,
    cpfCnpj: normalizeDigits(req.customer.cpf),
    mobilePhone: normalizeDigits(req.customer.phone),
    externalReference: req.orderId,
  };

  const customer = await asaasFetch<AsaasCustomerResponse>('/customers', customerPayload);

  if (!customer.id) {
    throw new Error('Asaas nao retornou ID do cliente.');
  }

  return customer.id;
}

export async function processAsaasPayment(req: PaymentRequest): Promise<PaymentResponse> {
  try {
    const customerId = await createAsaasCustomer(req);

    const paymentPayload: Record<string, unknown> = {
      customer: customerId,
      billingType: req.paymentMethod === 'pix' ? 'PIX' : 'CREDIT_CARD',
      value: req.amount,
      description: req.description,
      externalReference: req.orderId,
    };

    // Asaas requires a dueDate for non-credit-card payments (PIX, BOLETO).
    if (req.paymentMethod !== 'credit_card') {
      const due = (req as { dueDate?: string }).dueDate ?? new Date().toISOString().slice(0, 10);
      paymentPayload.dueDate = due;
    }

    if (req.paymentMethod === 'credit_card') {
      if (!req.creditCard) {
        return {
          success: false,
          status: 'refused',
          transactionId: `asaas_invalid_card_${req.orderId}`,
          errorMessage: 'Dados de cartao ausentes para pagamento no Asaas.',
        };
      }

      paymentPayload.creditCard = {
        holderName: req.creditCard.holderName,
        number: normalizeDigits(req.creditCard.number),
        expiryMonth: req.creditCard.expiryMonth,
        expiryYear: req.creditCard.expiryYear,
        ccv: req.creditCard.ccv,
      };

      paymentPayload.creditCardHolderInfo = {
        name: req.customer.name,
        email: req.customer.email,
        cpfCnpj: normalizeDigits(req.customer.cpf),
        postalCode: '00000000',
        addressNumber: '0',
        phone: normalizeDigits(req.customer.phone),
      };

      paymentPayload.installmentCount = Math.max(1, req.creditCard.installments);
      paymentPayload.installmentValue = Number((req.amount / Math.max(1, req.creditCard.installments)).toFixed(2));
      paymentPayload.remoteIp = '127.0.0.1';
    }

    const payment = await asaasFetch<AsaasPaymentResponse>('/payments', paymentPayload);

    if (!payment.id) {
      throw new Error('Asaas nao retornou ID da transacao.');
    }

    const mappedStatus = mapAsaasStatus(payment.status);

    if (req.paymentMethod === 'pix') {
      const pixData = await asaasFetch<AsaasPixQrResponse>(`/payments/${payment.id}/pixQrCode`);

      return {
        success: true,
        status: mappedStatus,
        transactionId: payment.id,
        pixCopiaECola: pixData.payload,
        pixQrCodeBase64: pixData.encodedImage,
      };
    }

    return {
      success: mappedStatus !== 'refused',
      status: mappedStatus,
      transactionId: payment.id,
      errorMessage: mappedStatus === 'refused' ? 'Pagamento recusado pelo gateway.' : undefined,
    };
  } catch (error) {
    console.error('[SmartCheckout] Erro no provider Asaas:', error);

    return {
      success: false,
      status: 'refused',
      transactionId: `asaas_error_${req.orderId}`,
      errorMessage: error instanceof Error ? error.message : 'Erro inesperado ao processar pagamento no Asaas.',
    };
  }
}
