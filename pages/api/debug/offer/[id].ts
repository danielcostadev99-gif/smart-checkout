import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';

type Resp = {
  ok: boolean;
  offer?: unknown;
  error?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ ok: false, error: 'Forbidden in production' });
    return;
  }

  const id = String(req.query.id ?? '');
  if (!id) {
    res.status(400).json({ ok: false, error: 'Missing id' });
    return;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('offers')
      .select('id, metadata, created_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      res.status(404).json({ ok: false, error: error?.message ?? 'Not found' });
      return;
    }

    res.status(200).json({ ok: true, offer: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
