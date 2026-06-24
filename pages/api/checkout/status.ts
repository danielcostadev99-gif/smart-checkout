import type { NextApiRequest, NextApiResponse } from 'next';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';

type StatusResponse = {
  orderId: string;
  status: string;
  accessDelivered: boolean;
} | {
  ok: false;
  message: string;
};

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StatusResponse>,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    return;
  }

  const { orderId } = req.query;

  if (typeof orderId !== 'string' || !isValidUuid(orderId)) {
    res.status(400).json({ ok: false, message: 'orderId inválido.' });
    return;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, status, access_delivered')
      .eq('id', orderId)
      .maybeSingle();

    if (error) {
      console.error('[SmartCheckout][Status] Erro ao consultar order:', error);
      res.status(500).json({ ok: false, message: 'Erro ao consultar pedido.' });
      return;
    }

    if (!order) {
      res.status(404).json({ ok: false, message: 'Pedido não encontrado.' });
      return;
    }

    res.status(200).json({
      orderId: order.id as string,
      status: order.status as string,
      accessDelivered: Boolean(order.access_delivered),
    });
  } catch (err) {
    console.error('[SmartCheckout][Status] Exceção ao consultar order:', err);
    res.status(500).json({ ok: false, message: 'Erro interno.' });
  }
}
