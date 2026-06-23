import { processAsaasPayment } from '@/src/modules/payment/providers/asaas';
import { processAppmaxPayment } from '@/src/modules/payment/providers/appmax';
import type {
  PaymentProvider,
  PaymentRequest,
  PaymentResponse,
} from '@/src/modules/payment/types';

function getPaymentProvider(): PaymentProvider {
  const provider = (process.env.PAYMENT_PROVIDER ?? 'asaas').trim().toLowerCase();

  if (provider === 'asaas' || provider === 'appmax') {
    return provider;
  }

  throw new Error(`PAYMENT_PROVIDER invalido: ${provider}. Use 'asaas' ou 'appmax'.`);
}

export async function executePayment(request: PaymentRequest): Promise<PaymentResponse> {
  const provider = getPaymentProvider();

  if (provider === 'asaas') {
    return processAsaasPayment(request);
  }

  return processAppmaxPayment(request);
}
