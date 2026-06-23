import { processAsaasPayment } from '@/src/modules/payment/providers/asaas';
import { processAppmaxPayment } from '@/src/modules/payment/providers/appmax';
import type {
  PaymentProvider,
  PaymentRequest,
  PaymentResponse,
} from '@/src/modules/payment/types';

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isSimulationEnabled(): boolean {
  return parseBooleanFlag(process.env.PAYMENT_SIMULATION_ENABLED);
}

function getSimulationStatus(request: PaymentRequest): PaymentResponse['status'] {
  const status = process.env.PAYMENT_SIMULATION_STATUS?.trim().toLowerCase();

  if (status === 'paid' || status === 'pending' || status === 'refused') {
    return status;
  }

  return request.paymentMethod === 'credit_card' ? 'paid' : 'pending';
}

function simulatePayment(request: PaymentRequest): PaymentResponse {
  const status = getSimulationStatus(request);
  const transactionId = `sim_${request.paymentMethod}_${request.orderId}_${Date.now()}`;

  if (status === 'refused') {
    return {
      success: false,
      status,
      transactionId,
      errorMessage: 'Pagamento recusado em simulacao.',
    };
  }

  const pendingPixPayload = request.paymentMethod === 'pix' && status === 'pending'
    ? {
      pixCopiaECola: `00020126580014BR.GOV.BCB.PIX0136SIMULACAO${request.orderId.slice(0, 8)}5204000053039865802BR5920SMART CHECKOUT TESTE6009SAO PAULO62070503***6304ABCD`,
      pixQrCodeBase64: 'U0lNVUxBQ0FPX1BJWF9RUl9DT0RF',
    }
    : {};

  return {
    success: true,
    status,
    transactionId,
    ...pendingPixPayload,
  };
}

function getPaymentProvider(): PaymentProvider {
  const provider = (process.env.PAYMENT_PROVIDER ?? 'asaas').trim().toLowerCase();

  if (provider === 'asaas' || provider === 'appmax') {
    return provider;
  }

  throw new Error(`PAYMENT_PROVIDER invalido: ${provider}. Use 'asaas' ou 'appmax'.`);
}

export async function executePayment(request: PaymentRequest): Promise<PaymentResponse> {
  if (isSimulationEnabled()) {
    console.info('[SmartCheckout] PAYMENT_SIMULATION_ENABLED ativo. Pagamento sera simulado.');
    return simulatePayment(request);
  }

  const provider = getPaymentProvider();

  if (provider === 'asaas') {
    return processAsaasPayment(request);
  }

  return processAppmaxPayment(request);
}
