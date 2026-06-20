import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase administrativo (service role key).
 * USO EXCLUSIVO em API Routes (server-side).
 * Bypassa RLS — NUNCA exponha no lado do cliente.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      '[SmartCheckout] Variáveis de ambiente do servidor ausentes.\n' +
      'Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  });
}
