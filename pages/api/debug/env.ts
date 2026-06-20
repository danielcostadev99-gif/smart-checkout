import type { NextApiRequest, NextApiResponse } from 'next';

type Resp = {
  ok: boolean;
  env?: {
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_HOST?: string;
    HAS_SUPABASE_SERVICE_ROLE_KEY: boolean;
    HAS_RESEND_API_KEY: boolean;
    NEXT_PUBLIC_APP_URL?: string;
  };
  error?: string;
};

export default function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  // Segurança: só permitir em dev
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ ok: false, error: 'Forbidden in production' });
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const host = typeof url === 'string' ? (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  })() : undefined;

  res.status(200).json({
    ok: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: url ? (url.length > 64 ? `${url.slice(0, 32)}...` : url) : undefined,
      NEXT_PUBLIC_SUPABASE_HOST: host ?? undefined,
      HAS_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      HAS_RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? undefined,
    },
  });
}
