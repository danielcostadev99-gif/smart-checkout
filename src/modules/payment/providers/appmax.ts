import type { PaymentRequest, PaymentResponse } from '@/src/modules/payment/types';

type AppmaxCustomerResponse = {
  id?: string;
  customerId?: string;
  data?: Record<string, unknown>;
};

type AppmaxPaymentResponse = {
  id?: string;
  transactionId?: string;
  status?: string;
  data?: Record<string, unknown>;
};

type AppmaxPixResponse = {
  pixCopiaECola?: string;
  pixQrCodeBase64?: string;
  copyPaste?: string;
  qrCodeBase64?: string;
  data?: Record<string, unknown>;
};

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function getAppmaxBaseUrl(): string {
  return process.env.APPMAX_BASE_URL?.trim() || 'https://api.appmax.com.br/v3';
}

function resolvePath(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const baseUrl = getAppmaxBaseUrl().replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function mapAppmaxStatus(status: string | undefined): 'paid' | 'pending' | 'refused' {
  if (!status) {
    return 'pending';
  }

  const normalized = status.toUpperCase();

  if (
    normalized === 'APPROVED'
    || normalized === 'PAID'
    || normalized === 'COMPLETED'
    || normalized === 'CONFIRMED'
  ) {
    return 'paid';
  }

  if (
    normalized === 'PENDING'
    || normalized === 'WAITING_PAYMENT'
    || normalized === 'AWAITING_PAYMENT'
    || normalized === 'PROCESSING'
  ) {
    return 'pending';
  }

  return 'refused';
}

function deepString(record: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = deepString(value as Record<string, unknown>, candidates);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

async function appmaxFetch<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST';
    payload?: unknown;
  },
): Promise<T> {
  const apiKey = process.env.GATEWAY_API_KEY;

  if (!apiKey) {
    throw new Error('GATEWAY_API_KEY nao configurada para o provider Appmax.');
  }

  const method = options?.method ?? (options?.payload ? 'POST' : 'GET');
  const timeoutMs = Number(process.env.GATEWAY_TIMEOUT_MS ?? '15000');

  const response = await fetch(resolvePath(path), {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
    body: options?.payload ? JSON.stringify(options.payload) : undefined,
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 15000),
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const message = deepString(json, ['message', 'error', 'detail', 'description'])
      || `Erro HTTP ${response.status} no Appmax`;
    throw new Error(message);
  }

  return json as T;
}

async function createAppmaxCustomer(req: PaymentRequest): Promise<string> {
  const customersPath = process.env.APPMAX_CUSTOMERS_PATH?.trim() || '/customers';

  const payload = {
    name: req.customer.name,
    email: req.customer.email,
    document: normalizeDigits(req.customer.cpf),
    phone: normalizeDigits(req.customer.phone),
    externalReference: req.orderId,
  };

  const response = await appmaxFetch<AppmaxCustomerResponse>(customersPath, {
    method: 'POST',
    payload,
  });

  const idFromRoot = response.id || response.customerId;
  if (idFromRoot) {
    return idFromRoot;
  }

  const idFromData = response.data ? deepString(response.data, ['id', 'customerId']) : undefined;
  if (idFromData) {
    return idFromData;
  }

  throw new Error('Appmax nao retornou ID do cliente.');
}

export async function processAppmaxPayment(req: PaymentRequest): Promise<PaymentResponse> {
  try {
    const customerId = await createAppmaxCustomer(req);
    const paymentsPath = process.env.APPMAX_PAYMENTS_PATH?.trim() || '/payments';

    const paymentPayload: Record<string, unknown> = {
      customerId,
      amount: req.amount,
      description: req.description,
      externalReference: req.orderId,
      paymentMethod: req.paymentMethod === 'pix' ? 'PIX' : 'CREDIT_CARD',
    };

    if (req.paymentMethod === 'credit_card') {
      if (!req.creditCard) {
        return {
          success: false,
          status: 'refused',
          transactionId: `appmax_invalid_card_${req.orderId}`,
          errorMessage: 'Dados de cartao ausentes para pagamento no Appmax.',
        };
      }

      paymentPayload.card = {
        holderName: req.creditCard.holderName,
        number: normalizeDigits(req.creditCard.number),
        expiryMonth: req.creditCard.expiryMonth,
        expiryYear: req.creditCard.expiryYear,
        cvv: req.creditCard.ccv,
      };
      paymentPayload.installments = Math.max(1, req.creditCard.installments);
      paymentPayload.customer = {
        name: req.customer.name,
        email: req.customer.email,
        document: normalizeDigits(req.customer.cpf),
        phone: normalizeDigits(req.customer.phone),
      };
    }

    const payment = await appmaxFetch<AppmaxPaymentResponse>(paymentsPath, {
      method: 'POST',
      payload: paymentPayload,
    });

    const paymentRecord = {
      ...(payment.data ?? {}),
      ...(payment as Record<string, unknown>),
    };

    const transactionId = payment.id
      || payment.transactionId
      || deepString(paymentRecord, ['id', 'transactionId', 'chargeId', 'paymentId']);

    if (!transactionId) {
      throw new Error('Appmax nao retornou ID da transacao.');
    }

    const statusRaw = payment.status || deepString(paymentRecord, ['status', 'paymentStatus']);
    const mappedStatus = mapAppmaxStatus(statusRaw);

    if (req.paymentMethod === 'pix') {
      let pixCopiaECola = deepString(paymentRecord, ['pixCopiaECola', 'copyPaste', 'pixCode', 'payload']);
      let pixQrCodeBase64 = deepString(paymentRecord, ['pixQrCodeBase64', 'qrCodeBase64', 'encodedImage']);

      if (!pixCopiaECola || !pixQrCodeBase64) {
        const pixPathTemplate = process.env.APPMAX_PIX_PATH_TEMPLATE?.trim() || '/payments/{id}/pix';
        const pixPath = pixPathTemplate.replace('{id}', transactionId);
        const pix = await appmaxFetch<AppmaxPixResponse>(pixPath).catch(() => null);

        if (pix) {
          const pixRecord = {
            ...(pix.data ?? {}),
            ...(pix as Record<string, unknown>),
          };

          pixCopiaECola = pixCopiaECola || deepString(pixRecord, ['pixCopiaECola', 'copyPaste', 'pixCode', 'payload']);
          pixQrCodeBase64 = pixQrCodeBase64 || deepString(pixRecord, ['pixQrCodeBase64', 'qrCodeBase64', 'encodedImage']);
        }
      }

      return {
        success: true,
        status: mappedStatus,
        transactionId,
        pixCopiaECola,
        pixQrCodeBase64,
      };
    }

    return {
      success: mappedStatus !== 'refused',
      status: mappedStatus,
      transactionId,
      errorMessage: mappedStatus === 'refused' ? 'Pagamento recusado pelo gateway.' : undefined,
    };
  } catch (error) {
    console.error('[SmartCheckout] Erro no provider Appmax:', error);

    return {
      success: false,
      status: 'refused',
      transactionId: `appmax_error_${req.orderId}`,
      errorMessage: error instanceof Error ? error.message : 'Erro inesperado ao processar pagamento no Appmax.',
    };
  }
}
