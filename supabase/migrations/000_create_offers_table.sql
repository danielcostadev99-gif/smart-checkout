-- ============================================================
-- SmartCheckout Engine — Migration 000
-- Execute ANTES da migration 001 (orders depende desta tabela).
-- Execute no Supabase: https://app.supabase.com → SQL Editor
-- ============================================================

-- Tabela de Ofertas (Offers)
CREATE TABLE IF NOT EXISTS offers (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    metadata    JSONB        NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Índice para buscas por data
CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers (created_at DESC);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa (chave anon) pode ler ofertas públicas
CREATE POLICY "allow_public_read_offers"
    ON offers
    FOR SELECT
    USING (true);

-- Somente a service role pode criar/atualizar/deletar ofertas
-- (a service role bypassa RLS automaticamente)

-- ============================================================
-- Exemplo de insert para testar:
-- INSERT INTO offers (metadata) VALUES (
--   '{"productName":"Meu Produto","price":97.00,"description":"Descrição opcional"}'
-- );
-- ============================================================
