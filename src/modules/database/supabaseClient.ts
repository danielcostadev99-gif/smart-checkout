import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Retorna o cliente Supabase público (chave anon) como singleton.
 * Utilizado nas páginas e em getServerSideProps.
 * Respeita as políticas de RLS do banco de dados.
 *
 * Avaliado apenas em runtime (não no build), evitando falhas
 * quando as variáveis de ambiente ainda não estão configuradas.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) {
    throw new Error(
      '[SmartCheckout] Variáveis de ambiente obrigatórias ausentes.\n' +
      'Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local'
    );
  }

  _client = createClient(supabaseUrl, supabaseAnon);
  return _client;
}
