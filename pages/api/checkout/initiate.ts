import type { NextApiRequest, NextApiResponse } from 'next';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';
import { sendMetaCapiEvent } from '@/src/modules/tracking/facebookCapi';
import type { TrackingParams } from '@/src/types';

type InitiateRequest = TrackingParams & {
  offerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCpf: string;
};

type InitiateResponse = {
  success: boolean;
  orderId?: string;
  created_at?: string;
  error?: string;
};

function isValidCpf(cpf: string): boolean {
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InitiateResponse>,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ success: false, error: 'Method Not Allowed' });
    return;
  }

  const body = req.body as InitiateRequest;

  const { offerId, customerName, customerEmail, customerPhone, customerCpf } = body;

  if (typeof offerId !== 'string' || !isValidUuid(offerId)) {
    res.status(400).json({ success: false, error: 'ID da oferta invalido.' });
    return;
  }

  if (typeof customerName !== 'string' || customerName.trim().length < 3) {
    res.status(400).json({ success: false, error: 'Nome invalido.' });
    return;
  }

  if (typeof customerEmail !== 'string' || !isValidEmail(customerEmail)) {
    res.status(400).json({ success: false, error: 'E-mail invalido.' });
    return;
  }

  if (typeof customerPhone !== 'string' || customerPhone.replace(/\D/g, '').length < 10) {
    res.status(400).json({ success: false, error: 'Telefone invalido.' });
    return;
  }

  if (typeof customerCpf !== 'string' || !isValidCpf(customerCpf)) {
    res.status(400).json({ success: false, error: 'CPF invalido.' });
    return;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: offer, error: offerError } = await supabaseAdmin
      .from('offers')
      .select('id, metadata')
      .eq('id', offerId)
      .single();

    if (offerError || !offer) {
      res.status(404).json({ success: false, error: 'Oferta nao encontrada.' });
      return;
    }

    const rawMeta = (
      typeof offer.metadata === 'string'
        ? JSON.parse(offer.metadata as string)
        : offer.metadata
    ) as Record<string, unknown>;

    const metaPixelId = typeof rawMeta.meta_pixel_id === 'string' ? rawMeta.meta_pixel_id.trim() : '';
    const metaAccessToken = typeof rawMeta.meta_access_token === 'string' ? rawMeta.meta_access_token.trim() : '';

    // Determine price from offer metadata (must not be null for DB constraint)
    let priceFromOffer: number | null = null;
    if (typeof rawMeta.price === 'number' && Number.isFinite(rawMeta.price)) {
      priceFromOffer = rawMeta.price;
    } else if (typeof rawMeta.price === 'string' && rawMeta.price.trim() !== '') {
      const n = Number((rawMeta.price as string).replace(/[^0-9.,-]/g, '').replace(',', '.'));
      if (Number.isFinite(n)) priceFromOffer = n;
    }

    if (priceFromOffer === null) {
      console.error('[InitiateCheckout] Preco da oferta invalido ou ausente no metadata', { offerId, rawMeta });
      res.status(422).json({ success: false, error: 'Oferta sem preco valido.' });
      return;
    }

    const orderAmount = Number(Number(priceFromOffer).toFixed(2));

    // Insert order with minimal fields for InitiateCheckout tracking
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        offer_id: offerId,
        payment_provider: null,
        customer_name: customerName.trim(),
        customer_email: customerEmail.toLowerCase().trim(),
        customer_cpf: customerCpf,
        customer_phone: customerPhone,
        payment_method: 'pix',
        status: 'pending',
        total_amount: orderAmount,
        meta_pixel_id: metaPixelId || null,
        meta_access_token: metaAccessToken || null,
        utm_source: body.utm_source ?? null,
        utm_campaign: body.utm_campaign ?? null,
        utm_medium: body.utm_medium ?? null,
        utm_content: body.utm_content ?? null,
        utm_term: body.utm_term ?? null,
        fbclid: body.fbclid ?? null,
        fbp: body.fbp ?? null,
        fbc: body.fbc ?? null,
        client_ip: null,
        client_user_agent: null,
        access_delivered: false,
      })
      .select('id, created_at, meta_pixel_id, meta_access_token')
      .single();

    if (orderError || !order) {
      console.error('[InitiateCheckout] Erro ao criar pedido:', orderError ?? null);
      res.status(500).json({ success: false, error: 'Erro interno ao criar pedido.' });
      return;
    }

    const orderId = order.id as string;

    // Build payload for Meta CAPI
    const orderData = {
      id: orderId,
      created_at: (order.created_at as string) ?? null,
      customer_name: customerName.trim(),
      customer_email: customerEmail.toLowerCase().trim(),
      customer_phone: customerPhone,
      customer_cpf: customerCpf,
      // total_amount and product_name may be filled later
    } as const;

    try {
      console.log('[SERVER INITIATE] Disparando InitiateCheckout, orderId:', orderId);
      await sendMetaCapiEvent('InitiateCheckout', orderData, order.meta_pixel_id ?? '', order.meta_access_token ?? '');
      console.log('[SERVER INITIATE] InitiateCheckout enviado');
    } catch (metaErr) {
      console.error('[SERVER INITIATE] Falha ao enviar InitiateCheckout:', metaErr);
    }

    res.status(200).json({ success: true, orderId, created_at: order.created_at as string });
  } catch (err) {
    console.error('[SERVER INITIATE] Excecao:', err);
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
}
