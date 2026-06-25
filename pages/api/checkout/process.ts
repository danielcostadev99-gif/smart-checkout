import type { NextApiRequest, NextApiResponse } from 'next';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';
import { sendDeliveryEmail } from '@/src/modules/notifications/deliveryEmail';
import { executePayment } from '@/src/modules/payment';
import { sendMetaCapiEvent } from '@/src/modules/tracking/facebookCapi';
import type {
  PaymentMethod,
  ProcessCheckoutRequest,
  ProcessCheckoutResponse,
  TrackingParams,
} from '@/src/types';

const VALID_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set(['pix', 'credit_card']);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidCpf(cpf: string): boolean {
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sanitizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function errorResponse(
  res: NextApiResponse<ProcessCheckoutResponse>,
  statusCode: number,
  message: string,
  paymentMethod: PaymentMethod = 'pix',
): void {
  res.status(statusCode).json({
    success: false,
    orderId: '',
    paymentMethod,
    productName: '',
    customerEmail: '',
    error: message,
  });
}

function parseCardExpiry(value: string): { month: string; year: string } | null {
  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) {
    return null;
  }

  const month = match[1];
  const shortYear = match[2];
  const monthNumber = Number(month);

  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  return {
    month,
    year: `20${shortYear}`,
  };
}

function getCurrentProvider(): string {
  return (process.env.PAYMENT_PROVIDER ?? 'asaas').trim().toLowerCase();
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractTrackingParams(body: Partial<ProcessCheckoutRequest>): TrackingParams {
  return {
    utm_source: normalizeNullableText(body.utm_source),
    utm_campaign: normalizeNullableText(body.utm_campaign),
    utm_medium: normalizeNullableText(body.utm_medium),
    utm_content: normalizeNullableText(body.utm_content),
    utm_term: normalizeNullableText(body.utm_term),
    fbclid: normalizeNullableText(body.fbclid),
    fbp: normalizeNullableText(body.fbp),
    fbc: normalizeNullableText(body.fbc),
  };
}

function extractClientIp(req: NextApiRequest): string | null {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstIp = rawValue?.split(',')[0]?.trim();
  return firstIp || req.socket.remoteAddress || null;
}

function extractUserAgent(req: NextApiRequest): string | null {
  const userAgent = req.headers['user-agent'];
  return Array.isArray(userAgent) ? userAgent[0] ?? null : userAgent ?? null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessCheckoutResponse>,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    errorResponse(res, 405, 'Method Not Allowed');
    return;
  }

  const body = req.body as Partial<ProcessCheckoutRequest>;
  const {
    offerId,
    customerName,
    customerEmail,
    customerPhone,
    customerCpf,
    paymentMethod,
    totalAmount,
  } = body;

  if (typeof offerId !== 'string' || !isValidUuid(offerId)) {
    errorResponse(res, 400, 'ID da oferta invalido.');
    return;
  }

  if (typeof customerName !== 'string' || customerName.trim().length < 3) {
    errorResponse(res, 400, 'Nome invalido. Informe o nome completo.');
    return;
  }

  if (typeof customerEmail !== 'string' || !isValidEmail(customerEmail)) {
    errorResponse(res, 400, 'E-mail invalido.');
    return;
  }

  if (typeof customerPhone !== 'string' || customerPhone.replace(/\D/g, '').length < 10) {
    errorResponse(res, 400, 'Telefone invalido.');
    return;
  }

  if (typeof customerCpf !== 'string' || !isValidCpf(customerCpf)) {
    errorResponse(res, 400, 'CPF invalido. Use o formato 000.000.000-00.');
    return;
  }

  if (!paymentMethod || !VALID_PAYMENT_METHODS.has(paymentMethod)) {
    errorResponse(res, 400, 'Metodo de pagamento invalido.');
    return;
  }

  if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    errorResponse(res, 400, 'Valor do pedido invalido.');
    return;
  }

  let parsedCardExpiry: { month: string; year: string } | null = null;
  if (paymentMethod === 'credit_card') {
    const { cardNumber, cardName, cardExpiry, cardCvv } = body;
    parsedCardExpiry = typeof cardExpiry === 'string' ? parseCardExpiry(cardExpiry) : null;

    if (
      typeof cardNumber !== 'string' || cardNumber.replace(/\s/g, '').length < 13
      || typeof cardName !== 'string' || cardName.trim().length < 3
      || !parsedCardExpiry
      || typeof cardCvv !== 'string' || cardCvv.length < 3
    ) {
      errorResponse(res, 400, 'Dados do cartao incompletos ou invalidos.', 'credit_card');
      return;
    }
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const trackingParams = extractTrackingParams(body);
    const clientIp = extractClientIp(req);
    const clientUserAgent = extractUserAgent(req);

    const { data: offer, error: offerError } = await supabaseAdmin
      .from('offers')
      .select('id, metadata')
      .eq('id', offerId)
      .single();

    if (offerError || !offer) {
      errorResponse(res, 404, 'Oferta nao encontrada.', paymentMethod);
      return;
    }

    const rawMeta = (
      typeof offer.metadata === 'string'
        ? (JSON.parse(offer.metadata) as Record<string, unknown>)
        : (offer.metadata as Record<string, unknown>)
    );

    const productName = typeof rawMeta.productName === 'string' ? rawMeta.productName : 'Produto';
    const priceFromOffer = typeof rawMeta.price === 'number' && Number.isFinite(rawMeta.price)
      ? rawMeta.price
      : totalAmount;
    const metaPixelId = typeof rawMeta.meta_pixel_id === 'string' ? rawMeta.meta_pixel_id.trim() : '';
    const metaAccessToken = typeof rawMeta.meta_access_token === 'string' ? rawMeta.meta_access_token.trim() : '';

    if (Math.abs(priceFromOffer - totalAmount) > 0.01) {
      console.warn(
        `[SmartCheckout] Divergencia de preco detectada (frontend=${totalAmount}, oferta=${priceFromOffer}). `
        + 'Usando preco da oferta.',
      );
    }

    const orderAmount = Number(priceFromOffer.toFixed(2));
    const gatewayProvider = getCurrentProvider();
    const normalizedEmail = customerEmail.toLowerCase().trim();
    const normalizedName = customerName.trim();
    const rawDownloadLink = typeof rawMeta.productDownloadUrl === 'string'
      ? rawMeta.productDownloadUrl.trim()
      : '';
    const productDownloadUrl = sanitizeUrl(rawDownloadLink);

    if (!productDownloadUrl) {
      errorResponse(res, 422, 'Oferta sem productDownloadUrl valido no metadata.', paymentMethod);
      return;
    }

    // If the frontend already created an order (step 1), the payload may include orderId.
    // In that case, fetch and update the order and DO NOT resend InitiateCheckout.
    const clientOrderId = (body as any).orderId as string | undefined;
    let orderId: string;

    if (clientOrderId && typeof clientOrderId === 'string') {
      const { data: existingOrder, error: fetchErr } = await supabaseAdmin
        .from('orders')
        .select('id, meta_pixel_id, meta_access_token, access_delivered, total_amount, created_at')
        .eq('id', clientOrderId)
        .maybeSingle();

      if (fetchErr) {
        console.error('[SmartCheckout] Erro ao buscar order existente:', fetchErr);
        errorResponse(res, 500, 'Erro interno ao buscar pedido.', paymentMethod);
        return;
      }

      if (!existingOrder) {
        errorResponse(res, 404, 'Pedido nao encontrado (orderId).', paymentMethod);
        return;
      }

      orderId = existingOrder.id as string;

      // Update minimal fields before payment
      const { error: updateErr } = await supabaseAdmin
        .from('orders')
        .update({
          customer_name: normalizedName,
          customer_email: normalizedEmail,
          customer_cpf: customerCpf,
          customer_phone: customerPhone,
          payment_method: paymentMethod,
          total_amount: orderAmount,
          client_ip: clientIp,
          client_user_agent: clientUserAgent,
        })
        .eq('id', orderId);

      if (updateErr) {
        console.error('[SmartCheckout] Erro ao atualizar order antes do pagamento:', updateErr);
        errorResponse(res, 500, 'Erro interno ao atualizar pedido.', paymentMethod);
        return;
      }
    } else {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert({
          offer_id: offerId,
          payment_provider: gatewayProvider,
          customer_name: normalizedName,
          customer_email: normalizedEmail,
          customer_cpf: customerCpf,
          customer_phone: customerPhone,
          payment_method: paymentMethod,
          status: 'pending',
          total_amount: orderAmount,
          meta_pixel_id: metaPixelId || null,
          meta_access_token: metaAccessToken || null,
          utm_source: trackingParams.utm_source ?? null,
          utm_campaign: trackingParams.utm_campaign ?? null,
          utm_medium: trackingParams.utm_medium ?? null,
          utm_content: trackingParams.utm_content ?? null,
          utm_term: trackingParams.utm_term ?? null,
          fbclid: trackingParams.fbclid ?? null,
          fbp: trackingParams.fbp ?? null,
          fbc: trackingParams.fbc ?? null,
          client_ip: clientIp,
          client_user_agent: clientUserAgent,
          access_delivered: false,
        })
        .select('id, created_at')
        .single();

      if (orderError || !order) {
        console.error('[SmartCheckout] Erro ao criar pedido:', orderError);
        errorResponse(res, 500, 'Erro interno ao registrar pedido.', paymentMethod);
        return;
      }

      orderId = order.id as string;

      try {
        await sendMetaCapiEvent(
          'InitiateCheckout',
          {
            id: orderId,
            created_at: (order.created_at as string) ?? null,
            customer_name: normalizedName,
            customer_email: normalizedEmail,
            customer_phone: customerPhone,
            customer_cpf: customerCpf,
            total_amount: orderAmount,
            product_name: productName,
            client_ip: clientIp,
            client_user_agent: clientUserAgent,
            ...trackingParams,
          },
          metaPixelId,
          metaAccessToken,
        );
      } catch (metaError) {
        console.error('[SmartCheckout] Falha ao enviar InitiateCheckout server-side:', {
          orderId,
          offerId,
          error: metaError,
        });
      }
    }

    const paymentResult = await executePayment({
      orderId,
      amount: orderAmount,
      description: typeof rawMeta.description === 'string' ? rawMeta.description : `Compra de ${productName}`,
      customer: {
        name: normalizedName,
        email: normalizedEmail,
        cpf: customerCpf,
        phone: customerPhone,
      },
      paymentMethod,
      creditCard: paymentMethod === 'credit_card' && parsedCardExpiry
        ? {
          holderName: body.cardName?.trim() ?? normalizedName,
          number: body.cardNumber ?? '',
          expiryMonth: parsedCardExpiry.month,
          expiryYear: parsedCardExpiry.year,
          ccv: body.cardCvv ?? '',
          installments: Math.max(1, body.installments ?? 1),
        }
        : undefined,
    });

    const { error: updatePaymentError } = await supabaseAdmin
      .from('orders')
      .update({
        status: paymentResult.status,
        payment_provider: gatewayProvider,
        external_transaction_id: paymentResult.transactionId,
        gateway_payload: {
          success: paymentResult.success,
          status: paymentResult.status,
          transactionId: paymentResult.transactionId,
          pixCopiaECola: paymentResult.pixCopiaECola ?? null,
          pixQrCodeBase64: paymentResult.pixQrCodeBase64 ?? null,
          errorMessage: paymentResult.errorMessage ?? null,
        },
      })
      .eq('id', orderId);

    if (updatePaymentError) {
      console.error('[SmartCheckout] Erro ao atualizar dados de pagamento da order:', updatePaymentError);
      errorResponse(res, 500, 'Erro interno ao atualizar pedido.', paymentMethod);
      return;
    }

    if (paymentResult.status === 'paid') {
      // Default delivery link is the Drive link from the offer metadata
      let deliveryLink = productDownloadUrl;

      // Check if there's a product with the same id as the offer (product_id === offer_id)
      const { data: product, error: productError } = await supabaseAdmin
        .from('products')
        .select('id')
        .eq('id', offerId)
        .maybeSingle();

      if (productError) {
        console.error('[SmartCheckout] Erro ao buscar produto correspondente:', productError);
      }

      if (product) {
        // If a corresponding product exists, switch delivery to MemberKit URL
        deliveryLink = (process.env.NEXT_PUBLIC_MEMBERKIT_URL ?? 'https://memberkit.vercel.app/').trim();

        try {
          // Find the buyer in auth.users by email
          const { data: user } = await supabaseAdmin
            .from('auth.users')
            .select('id')
            .eq('email', normalizedEmail)
            .maybeSingle();

          if (user && user.id) {
            // Upsert user access, scoping conflict to user_id,product_id
            const { error: upsertError } = await supabaseAdmin
              .from('user_access')
              .upsert([
                {
                  user_id: user.id,
                  product_id: product.id,
                  status: 'active',
                },
              ], { onConflict: 'user_id,product_id' });

            if (upsertError) {
              console.error('[SmartCheckout] Erro ao upsert na tabela user_access:', upsertError);
            }
          }
        } catch (err) {
          console.error('[SmartCheckout] Erro inesperado ao provisionar acesso no MemberKit:', err);
        }
      }

      const emailResult = await sendDeliveryEmail({
        orderId,
        customerName: normalizedName,
        customerEmail: normalizedEmail,
        productName,
        productDownloadUrl: deliveryLink,
      });

      if (emailResult.sent) {
        const { error: deliveredError } = await supabaseAdmin
          .from('orders')
          .update({ access_delivered: true })
          .eq('id', orderId);

        if (deliveredError) {
          console.error('[SmartCheckout] Erro ao marcar access_delivered:', deliveredError);
        }
      }
    }

    if (paymentResult.status === 'refused') {
      res.status(200).json({
        success: false,
        orderId,
        paymentMethod,
        paymentStatus: 'refused',
        transactionId: paymentResult.transactionId,
        productName,
        customerEmail: normalizedEmail,
        error: paymentResult.errorMessage || 'Pagamento recusado pelo gateway.',
      });
      return;
    }

    const pixCode = paymentResult.pixCopiaECola;
    const pixQrCodeUrl = pixCode
      ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&ecc=M&data=${encodeURIComponent(pixCode)}`
      : undefined;

    res.status(200).json({
      success: true,
      orderId,
      paymentMethod,
      paymentStatus: paymentResult.status,
      transactionId: paymentResult.transactionId,
      productName,
      customerEmail: normalizedEmail,
      pixCode,
      pixQrCodeUrl,
    });
  } catch (error) {
    console.error('[SmartCheckout] Erro inesperado no checkout:', error);
    errorResponse(res, 500, 'Erro inesperado ao processar checkout.');
  }
}
