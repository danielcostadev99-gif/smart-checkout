-- ============================================================
-- SmartCheckout Engine — Migration 004
-- Adiciona colunas de tracking e credenciais dinâmicas da Meta.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS fbclid TEXT,
  ADD COLUMN IF NOT EXISTS fbp TEXT,
  ADD COLUMN IF NOT EXISTS fbc TEXT,
  ADD COLUMN IF NOT EXISTS client_ip TEXT,
  ADD COLUMN IF NOT EXISTS client_user_agent TEXT;

COMMENT ON COLUMN orders.meta_pixel_id IS 'Pixel ID da Meta persistido por pedido para eventos server-side por oferta';
COMMENT ON COLUMN orders.meta_access_token IS 'Access Token da Conversion API da Meta persistido por pedido';
COMMENT ON COLUMN orders.utm_source IS 'UTM source recebida da landing page';
COMMENT ON COLUMN orders.utm_campaign IS 'UTM campaign recebida da landing page';
COMMENT ON COLUMN orders.utm_medium IS 'UTM medium recebida da landing page';
COMMENT ON COLUMN orders.utm_content IS 'UTM content recebida da landing page';
COMMENT ON COLUMN orders.utm_term IS 'UTM term recebida da landing page';
COMMENT ON COLUMN orders.fbclid IS 'Facebook Click ID recebido na URL';
COMMENT ON COLUMN orders.fbp IS 'Facebook Browser ID recebido na URL';
COMMENT ON COLUMN orders.fbc IS 'Facebook Click Browser ID recebido na URL ou derivado do fbclid';
COMMENT ON COLUMN orders.client_ip IS 'IP real do cliente no momento da criacao da order';
COMMENT ON COLUMN orders.client_user_agent IS 'User-Agent do cliente no momento da criacao da order';