import type { NextApiRequest, NextApiResponse } from 'next';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';
import { sendDeliveryEmail } from '@/src/modules/notifications/deliveryEmail';

type ProcessResponse = {
  processed: number;
  failed: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessResponse | { ok: false; message: string }>,
): Promise<void> {
  const requestId = (req.headers['x-vercel-id'] as string) || '';
  const trigger = req.method === 'GET' ? 'cron' : 'manual';

  console.info('[SmartCheckout][WebhookProcessor] Request received', {
    method: req.method,
    url: req.url,
    trigger,
    requestId,
  });

  // Allow GET (Vercel Cron) and POST (manual trigger)
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    return;
  }

  const processSecret = process.env.GATEWAY_WEBHOOK_PROCESS_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (processSecret) {
    const receivedHeader = (req.headers['x-webhook-process-secret'] as string) || (req.headers['x-process-secret'] as string) || '';
    const authHeader = (req.headers['authorization'] as string) || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    const matchesProcessSecret = receivedHeader === processSecret || bearerToken === processSecret;
    const matchesCronSecret = cronSecret && bearerToken === cronSecret;

    if (!matchesProcessSecret && !matchesCronSecret) {
      console.warn('[SmartCheckout][WebhookProcessor] Unauthorized request (secret mismatch)', {
        trigger,
        hasProcessSecret: Boolean(processSecret),
        hasCronSecret: Boolean(cronSecret),
      });
      res.status(401).json({ ok: false, message: 'Unauthorized' });
      return;
    }
  } else if (cronSecret) {
    const authHeader = (req.headers['authorization'] as string) || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (bearerToken !== cronSecret) {
      console.warn('[SmartCheckout][WebhookProcessor] Unauthorized request (cron secret mismatch)', {
        trigger,
      });
      res.status(401).json({ ok: false, message: 'Unauthorized' });
      return;
    }
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    // Reset events stuck in 'processing' for more than 2 minutes (serverless termination recovery)
    const stuckCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: resetRows, error: resetError } = await supabaseAdmin
      .from('webhook_events')
      .update({ status: 'pending' })
      .eq('status', 'processing')
      .lt('received_at', stuckCutoff)
      .select('id');

    if (resetError) {
      console.error('[SmartCheckout][WebhookProcessor] Failed to reset stuck events', { error: resetError });
    } else if (Array.isArray(resetRows) && resetRows.length > 0) {
      console.info('[SmartCheckout][WebhookProcessor] Reset stuck events to pending', {
        count: resetRows.length,
      });
    }

    const { data: events } = await supabaseAdmin
      .from('webhook_events')
      .select('*')
      .eq('status', 'pending')
      .order('received_at', { ascending: true })
      .limit(20);

    console.info('[SmartCheckout][WebhookProcessor] Pending batch loaded', {
      count: events?.length ?? 0,
      limit: 20,
    });

    if (!events || events.length === 0) {
      console.info('[SmartCheckout][WebhookProcessor] No pending events in this run');
      res.status(200).json({ processed: 0, failed: 0 });
      return;
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const ev of events) {
      const eventId = ev.event_id ?? null;
      console.info('[SmartCheckout][WebhookProcessor] Processing event', {
        webhookEventRowId: ev.id,
        eventId,
        eventType: ev.event_type ?? null,
        attemptsBefore: ev.attempts ?? 0,
      });

      // mark processing
      const { error: markErr } = await supabaseAdmin
        .from('webhook_events')
        .update({ status: 'processing', attempts: (ev.attempts ?? 0) + 1 })
        .eq('id', ev.id);

      if (markErr) {
        console.error('[SmartCheckout] Erro ao marcar webhook_event como processing', { id: ev.id, error: markErr });
        failedCount += 1;
        continue;
      }

      try {
        const payload = ev.payload as any;
        const snapshot = (payload.payment ?? payload.data ?? payload.transaction) ?? {};
        const transactionId = snapshot.id ?? '';
        const externalReference = snapshot.externalReference ?? '';
        const status = (snapshot.status ?? '')?.toUpperCase?.() ?? '';

        // we only process approved/received events
        const isApproved = (payload.event ?? '').toUpperCase().includes('PAYMENT_RECEIVED')
          || (payload.event ?? '').toUpperCase().includes('PAYMENT_CONFIRMED')
          || status === 'RECEIVED' || status === 'CONFIRMED' || status === 'PAID';

        if (!isApproved) {
          // mark processed but ignored
          await supabaseAdmin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', ev.id);
          console.info('[SmartCheckout][WebhookProcessor] Event ignored (not approved)', {
            webhookEventRowId: ev.id,
            eventId,
            status,
          });
          processedCount += 1;
          continue;
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
          console.warn('[SmartCheckout] Nenhuma order encontrada ao processar webhook_event.', { eventId, transactionId, externalReference });
          await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: 'Order not found' }).eq('id', ev.id);
          console.warn('[SmartCheckout][WebhookProcessor] Event failed (order not found)', {
            webhookEventRowId: ev.id,
            eventId,
            transactionId,
            externalReference,
          });
          failedCount += 1;
          continue;
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
            external_transaction_id: transactionId || null,
            gateway_payload: gatewayPayload,
          })
          .eq('id', order.id);

        if (updateOrderError) {
          console.error('[SmartCheckout] Erro ao atualizar order via webhook_events processing:', updateOrderError);
          const orderErrMsg = updateOrderError.message ?? JSON.stringify(updateOrderError);
          await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: orderErrMsg }).eq('id', ev.id);
          failedCount += 1;
          continue;
        }

        if (order.access_delivered) {
          await supabaseAdmin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', ev.id);
          console.info('[SmartCheckout][WebhookProcessor] Event processed (already delivered)', {
            webhookEventRowId: ev.id,
            eventId,
            orderId: order.id,
          });
          processedCount += 1;
          continue;
        }

        // prepare email
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
            productDownloadUrl = rawDownloadLink || null;
          }
        }

        if (!productDownloadUrl) {
          console.error('[SmartCheckout] productDownloadUrl ausente ao processar webhook_event.', { orderId: order.id, offerId: order.offer_id });
          await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: 'productDownloadUrl missing' }).eq('id', ev.id);
          console.error('[SmartCheckout][WebhookProcessor] Event failed (productDownloadUrl missing)', {
            webhookEventRowId: ev.id,
            eventId,
            orderId: order.id,
            offerId: order.offer_id,
          });
          failedCount += 1;
          continue;
        }

        const emailResult = await sendDeliveryEmail({
          orderId: order.id,
          customerName: order.customer_name,
          customerEmail: order.customer_email,
          productName,
          productDownloadUrl,
        });

        console.info('[SmartCheckout] Delivery email result (processor)', { orderId: order.id, recipient: emailResult.recipientUsed, sent: emailResult.sent, messageId: emailResult.messageId ?? null, error: emailResult.error ?? null });

        if (emailResult.sent) {
          const { error: deliveredError } = await supabaseAdmin
            .from('orders')
            .update({ access_delivered: true })
            .eq('id', order.id);

          if (deliveredError) {
            console.error('[SmartCheckout] Erro ao marcar access_delivered no processor:', deliveredError);
          }
        }

        await supabaseAdmin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', ev.id);
        console.info('[SmartCheckout][WebhookProcessor] Event processed successfully', {
          webhookEventRowId: ev.id,
          eventId,
          orderId: order.id,
          emailSent: emailResult.sent,
        });
        processedCount += 1;
      } catch (err) {
        console.error('[SmartCheckout] Erro ao processar webhook_event:', err);
        const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
        await supabaseAdmin.from('webhook_events').update({ status: 'failed', last_error: errMsg }).eq('id', ev.id);
        console.error('[SmartCheckout][WebhookProcessor] Event failed with exception', {
          webhookEventRowId: ev.id,
          eventId,
          errMsg,
        });
        failedCount += 1;
      }
    }

    console.info('[SmartCheckout][WebhookProcessor] Run finished', {
      processed: processedCount,
      failed: failedCount,
      total: events.length,
    });
    res.status(200).json({ processed: processedCount, failed: failedCount });
  } catch (error) {
    console.error('[SmartCheckout] Excecao no process-pending webhook:', error);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
}
