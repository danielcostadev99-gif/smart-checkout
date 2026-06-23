import type { NextApiRequest, NextApiResponse } from 'next';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';
import { sendDeliveryEmail } from '@/src/modules/notifications/deliveryEmail';

type WebhookResponse = {
  ok: boolean;
  message: string;
};

type PaymentWebhookPayload = {
  event?: string;
  payment?: {
    id?: string;
    externalReference?: string;
    status?: string;
  };
  data?: {
    id?: string;
    externalReference?: string;
    status?: string;
  };
  transaction?: {
    id?: string;
    externalReference?: string;
    status?: string;
  };
};

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function extractWebhookToken(req: NextApiRequest): string {
  const xGatewayToken = req.headers['x-gateway-token'];
  const xWebhookToken = req.headers['x-webhook-token'];
  const asaasAccessToken = req.headers['asaas-access-token'];
  const authorization = req.headers.authorization;

  const fromHeader = (header: string | string[] | undefined): string => {
    if (!header) {
      return '';
    }
    return Array.isArray(header) ? header[0] ?? '' : header;
  };

  const explicit = fromHeader(xGatewayToken) || fromHeader(xWebhookToken) || fromHeader(asaasAccessToken);
  if (explicit) {
    return explicit.trim();
  }

  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return '';
}

function getPaymentSnapshot(payload: PaymentWebhookPayload): {
  eventName: string;
  transactionId: string;
  externalReference: string;
  status: string;
} {
  const source = payload.payment ?? payload.data ?? payload.transaction ?? {};

  return {
    eventName: (payload.event ?? '').toUpperCase(),
    transactionId: source.id ?? '',
    externalReference: source.externalReference ?? '',
    status: (source.status ?? '').toUpperCase(),
  };
}

function isApprovedEvent(eventName: string, status: string): boolean {
  if (eventName.includes('PAYMENT_RECEIVED') || eventName.includes('PAYMENT_CONFIRMED')) {
    return true;
  }

  if (eventName.includes('PAYMENT.APPROVED') || eventName.includes('CHARGE.PAID')) {
    return true;
  }

  return status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH' || status === 'PAID';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WebhookResponse>,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    return;
  }

  const expectedSecret = process.env.GATEWAY_WEBHOOK_SECRET?.trim();
  const receivedToken = extractWebhookToken(req);

  if (!expectedSecret || receivedToken !== expectedSecret) {
    console.warn('[SmartCheckout] Webhook bloqueado por token invalido.');
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }

  try {
    const payload = req.body as PaymentWebhookPayload;
    const snapshot = getPaymentSnapshot(payload);

    if (!snapshot.transactionId && !snapshot.externalReference) {
      console.warn('[SmartCheckout] Webhook sem identificador de transacao/reference.');
      res.status(400).json({ ok: false, message: 'Invalid webhook payload' });
      return;
    }

    if (!isApprovedEvent(snapshot.eventName, snapshot.status)) {
      console.info('[SmartCheckout] Webhook recebido sem evento de aprovacao.', {
        event: snapshot.eventName,
        status: snapshot.status,
      });
      res.status(200).json({ ok: true, message: 'Event ignored (not approved)' });
      return;
    }

    const supabaseAdmin = getSupabaseAdmin();

    let order:
      | {
        id: string;
        offer_id: string | null;
        customer_name: string;
        customer_email: string;
        status: string;
        access_delivered: boolean;
      }
      | null = null;

    if (snapshot.transactionId) {
      const { data } = await supabaseAdmin
        .from('orders')
        .select('id, offer_id, customer_name, customer_email, status, access_delivered')
        .eq('external_transaction_id', snapshot.transactionId)
        .maybeSingle();

      order = data;
    }

    if (!order && snapshot.externalReference && isUuid(snapshot.externalReference)) {
      const { data } = await supabaseAdmin
        .from('orders')
        .select('id, offer_id, customer_name, customer_email, status, access_delivered')
        .eq('id', snapshot.externalReference)
        .maybeSingle();

      order = data;
    }

    if (!order) {
      console.warn('[SmartCheckout] Nenhuma order encontrada para webhook.', snapshot);
      res.status(404).json({ ok: false, message: 'Order not found' });
      return;
    }

    const gatewayPayload = {
      receivedAt: new Date().toISOString(),
      snapshot,
      raw: payload,
    } as const;

    const { error: updateOrderError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'paid',
        external_transaction_id: snapshot.transactionId || null,
        gateway_payload: gatewayPayload,
      })
      .eq('id', order.id);

    if (updateOrderError) {
      console.error('[SmartCheckout] Erro ao atualizar order via webhook:', updateOrderError);
      res.status(500).json({ ok: false, message: 'Order update failed' });
      return;
    }

    if (order.access_delivered) {
      res.status(200).json({ ok: true, message: 'Order already delivered' });
      return;
    }

    let productName = 'Produto';
    let productDownloadUrl: string | null = null;

    if (order.offer_id) {
      const { data: offer } = await supabaseAdmin
        .from('offers')
        .select('metadata')
        .eq('id', order.offer_id)
        .maybeSingle();

      if (offer?.metadata) {
        const rawMeta = typeof offer.metadata === 'string'
          ? (JSON.parse(offer.metadata) as Record<string, unknown>)
          : (offer.metadata as Record<string, unknown>);

        if (typeof rawMeta.productName === 'string') {
          productName = rawMeta.productName;
        }

        const rawDownloadLink = typeof rawMeta.productDownloadUrl === 'string'
          ? rawMeta.productDownloadUrl.trim()
          : '';
        productDownloadUrl = sanitizeUrl(rawDownloadLink);
      }
    }

    if (!productDownloadUrl) {
      console.error('[SmartCheckout] productDownloadUrl ausente ou invalido no metadata da oferta.', {
        orderId: order.id,
        offerId: order.offer_id,
      });
      res.status(422).json({ ok: false, message: 'Offer metadata missing valid productDownloadUrl' });
      return;
    }

    const emailResult = await sendDeliveryEmail({
      orderId: order.id,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      productName,
      productDownloadUrl,
    });

    if (emailResult.sent) {
      const { error: deliveredError } = await supabaseAdmin
        .from('orders')
        .update({ access_delivered: true })
        .eq('id', order.id);

      if (deliveredError) {
        console.error('[SmartCheckout] Erro ao marcar access_delivered no webhook:', deliveredError);
      }
    }

    res.status(200).json({ ok: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('[SmartCheckout] Excecao no webhook de pagamento:', error);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
}
