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

function maskToken(value: string | undefined): string {
  if (!value) return '';
  try {
    const v = value.trim();
    if (v.length <= 10) return '****';
    return `${v.slice(0, 4)}****${v.slice(-4)}`;
  } catch {
    return '****';
  }
}

function truncateString(s: string, max = 1000): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}... (truncated)`;
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

type SyncProcessResult = {
  ok: boolean;
  message: string;
};

async function processQueuedEventById(insertedId: string): Promise<SyncProcessResult> {
  const supabaseAdmin = getSupabaseAdmin();

  // mark processing
  const { error: markErr } = await supabaseAdmin
    .from('webhook_events')
    .update({ status: 'processing', attempts: 1 })
    .eq('id', insertedId);

  if (markErr) {
    return { ok: false, message: markErr.message ?? JSON.stringify(markErr) };
  }

  // load event
  const { data: evRows, error: loadErr } = await supabaseAdmin
    .from('webhook_events')
    .select('*')
    .eq('id', insertedId)
    .limit(1);

  if (loadErr) {
    await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: loadErr.message ?? JSON.stringify(loadErr) }).eq('id', insertedId);
    return { ok: false, message: loadErr.message ?? JSON.stringify(loadErr) };
  }

  const ev = Array.isArray(evRows) && evRows.length > 0 ? evRows[0] : null;
  if (!ev) {
    await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: 'Inserted event not found' }).eq('id', insertedId);
    return { ok: false, message: 'Inserted event not found' };
  }

  try {
    const payloadNow = ev.payload as any;
    const snapshotNow = (payloadNow.payment ?? payloadNow.data ?? payloadNow.transaction) ?? {};
    const eventName = (payloadNow.event ?? '').toUpperCase();
    const transactionId = snapshotNow.id ?? '';
    const externalReference = snapshotNow.externalReference ?? '';
    const status = (snapshotNow.status ?? '').toUpperCase();

    if (!isApprovedEvent(eventName, status)) {
      await supabaseAdmin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', insertedId);
      return { ok: true, message: 'Event ignored (not approved)' };
    }

    // find order
    let order: any = null;

    if (transactionId) {
      const { data } = await supabaseAdmin
        .from('orders')
        .select('id, offer_id, customer_name, customer_email, status, access_delivered')
        .eq('external_transaction_id', transactionId)
        .maybeSingle();

      order = data;
    }

    if (!order && externalReference) {
      const { data } = await supabaseAdmin
        .from('orders')
        .select('id, offer_id, customer_name, customer_email, status, access_delivered')
        .eq('id', externalReference)
        .maybeSingle();

      order = data;
    }

    if (!order) {
      await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: 'Order not found' }).eq('id', insertedId);
      return { ok: false, message: 'Order not found' };
    }

    const gatewayPayloadNow = { receivedAt: new Date().toISOString(), snapshot: snapshotNow, raw: payloadNow } as const;

    const { error: updateOrderError } = await supabaseAdmin
      .from('orders')
      .update({ status: 'paid', external_transaction_id: transactionId || null, gateway_payload: gatewayPayloadNow })
      .eq('id', order.id);

    if (updateOrderError) {
      const orderErrMsg = updateOrderError.message ?? JSON.stringify(updateOrderError);
      await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: orderErrMsg }).eq('id', insertedId);
      return { ok: false, message: orderErrMsg };
    }

    if (order.access_delivered) {
      await supabaseAdmin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', insertedId);
      return { ok: true, message: 'Already delivered' };
    }

    // prepare and send email
    let productName = 'Produto';
    let productDownloadUrl: string | null = null;

    if (order.offer_id) {
      const { data: offer } = await supabaseAdmin
        .from('offers')
        .select('metadata')
        .eq('id', order.offer_id)
        .maybeSingle();

      if (offer?.metadata) {
        const rawMeta = typeof offer.metadata === 'string' ? (JSON.parse(offer.metadata) as Record<string, unknown>) : (offer.metadata as Record<string, unknown>);
        if (typeof rawMeta.productName === 'string') productName = rawMeta.productName;
        const rawDownloadLink = typeof rawMeta.productDownloadUrl === 'string' ? rawMeta.productDownloadUrl.trim() : '';
        productDownloadUrl = rawDownloadLink || null;
      }
    }

    if (!productDownloadUrl) {
      await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: 'productDownloadUrl missing' }).eq('id', insertedId);
      return { ok: false, message: 'productDownloadUrl missing' };
    }

    const emailResult = await sendDeliveryEmail({ orderId: order.id, customerName: order.customer_name, customerEmail: order.customer_email, productName, productDownloadUrl });

    if (emailResult.sent) {
      const { error: deliveredError } = await supabaseAdmin.from('orders').update({ access_delivered: true }).eq('id', order.id);
      if (deliveredError) {
        console.error('[SmartCheckout][Webhook] Erro ao marcar access_delivered no sync processor:', deliveredError);
      }
    }

    await supabaseAdmin
      .from('webhook_events')
      .update({
        status: emailResult.sent ? 'processed' : 'failed',
        processed_at: new Date().toISOString(),
        last_error: emailResult.sent ? null : String(emailResult.error ?? 'unknown'),
      })
      .eq('id', insertedId);

    if (emailResult.sent) {
      return { ok: true, message: 'Processed and delivered' };
    }

    return { ok: false, message: String(emailResult.error ?? 'unknown') };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
    await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: errMsg }).eq('id', insertedId);
    return { ok: false, message: errMsg };
  }
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

  const receivedAt = new Date().toISOString();
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  console.info('[SmartCheckout][Webhook] Received request', { receivedAt, ip: clientIp, method: req.method, url: req.url });

  // Log presence of important headers and a masked preview of authorization
  const hasXGatewayToken = Boolean(req.headers['x-gateway-token']);
  const hasXWebhookToken = Boolean(req.headers['x-webhook-token']);
  const hasAsaasAccessToken = Boolean(req.headers['asaas-access-token']);
  const authHeader = typeof req.headers.authorization === 'string' ? maskToken(req.headers.authorization) : '';
  console.info('[SmartCheckout][Webhook] Header presence', { hasXGatewayToken, hasXWebhookToken, hasAsaasAccessToken, authorization: authHeader });

  // Body preview (truncated)
  try {
    const bodyPreview = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    console.info('[SmartCheckout][Webhook] Body preview', truncateString(bodyPreview, 2000));
  } catch (err) {
    console.info('[SmartCheckout][Webhook] Body preview unavailable', err);
  }

  const expectedSecret = process.env.GATEWAY_WEBHOOK_SECRET?.trim();
  const receivedToken = extractWebhookToken(req);
  const permissive = String(process.env.GATEWAY_WEBHOOK_PERMISSIVE ?? '').toLowerCase() === 'true';

  if (expectedSecret) {
    if (receivedToken !== expectedSecret) {
      if (permissive) {
        console.warn('[SmartCheckout] Webhook token mismatch, but permissive mode enabled — accepting request for debugging.');
      } else {
        console.warn('[SmartCheckout] Webhook bloqueado por token invalido.');
        res.status(401).json({ ok: false, message: 'Unauthorized' });
        return;
      }
    }
  } else {
    console.warn('[SmartCheckout] GATEWAY_WEBHOOK_SECRET nao definido — aceitando webhook sem autenticacao (inseguro).');
  }

  try {
    const payload = req.body as PaymentWebhookPayload;
    const snapshot = getPaymentSnapshot(payload);

    // basic validation
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

    const eventId = (payload as any)?.id ?? null;
    const eventType = (payload as any)?.event ?? null;

    if (eventId) {
      const { data: existing } = await supabaseAdmin
        .from('webhook_events')
        .select('id,status')
        .eq('event_id', eventId)
        .maybeSingle();

      if (existing) {
        console.info('[SmartCheckout] Evento do webhook ja registrado (idempotencia)', { eventId, status: existing.status });
        res.status(200).json({ ok: true, message: 'Event already recorded' });
        return;
      }
    }

    const { data: insertedRows, error: insertErr } = await supabaseAdmin
      .from('webhook_events')
      .insert({
        event_id: eventId,
        event_type: eventType,
        received_at: new Date().toISOString(),
        payload,
        status: 'pending',
      })
      .select('id')
      .limit(1);

    if (insertErr) {
      console.error('[SmartCheckout] Erro ao persistir webhook_event:', insertErr);
      res.status(500).json({ ok: false, message: 'Failed to persist webhook event' });
      return;
    }

    const insertedId = Array.isArray(insertedRows) && insertedRows[0]?.id ? insertedRows[0].id : null;

    console.info('[SmartCheckout] webhook_event persisted', { eventId, insertedId });
    console.info('[SmartCheckout][Webhook] Event queued for process-pending worker', {
      eventId,
      insertedId,
      eventType,
      transactionId: snapshot.transactionId,
      externalReference: snapshot.externalReference,
    });

    // Try synchronous processing in-request for Hobby plans (no frequent cron).
    // If it takes too long, keep event pending/processing and let worker pick it up later.
    const syncTimeoutMs = Number(process.env.GATEWAY_WEBHOOK_SYNC_TIMEOUT_MS ?? 10000);
    const syncEnabled = String(process.env.GATEWAY_WEBHOOK_SYNC_PROCESSING ?? 'true').toLowerCase() !== 'false';

    if (insertedId && syncEnabled) {
      const timeoutPromise = new Promise<SyncProcessResult>((resolve) => {
        setTimeout(() => resolve({ ok: true, message: 'Recorded, sync timeout fallback to worker' }), syncTimeoutMs);
      });

      const syncResult = await Promise.race([processQueuedEventById(insertedId), timeoutPromise]);
      console.info('[SmartCheckout][Webhook] Sync processing result', {
        insertedId,
        eventId,
        ok: syncResult.ok,
        message: syncResult.message,
        timeoutMs: syncTimeoutMs,
      });

      res.status(200).json({ ok: true, message: syncResult.message });
      return;
    }

    // Fallback: keep only queue write if sync mode disabled.
    res.status(200).json({ ok: true, message: 'Webhook recorded' });
    return;
  } catch (error) {
    console.error('[SmartCheckout] Excecao ao registrar webhook_event:', error);
    res.status(500).json({ ok: false, message: 'Internal server error' });
    return;
  }
}
