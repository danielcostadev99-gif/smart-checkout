-- ============================================================
-- SmartCheckout Engine — Migration 001
-- Execute este script no Editor de Consultas do Supabase:
--   https://app.supabase.com → SQL Editor → New query
-- ============================================================

-- Tabela de Pedidos (Orders)
CREATE TABLE IF NOT EXISTS orders (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id          UUID         REFERENCES offers(id) ON DELETE SET NULL,
    customer_name     TEXT         NOT NULL,
    customer_email    TEXT         NOT NULL,
    customer_cpf      TEXT         NOT NULL,
    customer_phone    TEXT         NOT NULL,
    payment_method    TEXT         NOT NULL CHECK (payment_method IN ('pix', 'credit_card')),
    status            TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refused')),
    total_amount      NUMERIC(10, 2) NOT NULL CHECK (total_amount > 0),
    access_delivered  BOOLEAN      NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_orders_offer_id     ON orders (offer_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at    ON orders (created_at DESC);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Política 1: Qualquer pessoa (chave anon) pode criar um pedido via checkout público
CREATE POLICY "allow_public_insert_orders"
    ON orders
    FOR INSERT
    WITH CHECK (true);

-- Política 2: Apenas a service role (servidor) pode ler e atualizar pedidos.
-- A service role bypassa RLS automaticamente — esta política é para a chave anon.
-- Usuários anônimos NÃO podem listar ou ler pedidos de outros clientes.
-- (Sem política de SELECT → anon não consegue listar nada)

-- ============================================================
-- Comentários nas colunas
-- ============================================================

COMMENT ON COLUMN orders.payment_method  IS 'Método de pagamento: pix ou credit_card';
COMMENT ON COLUMN orders.status          IS 'Status do pedido: pending | paid | refused';
COMMENT ON COLUMN orders.access_delivered IS 'true quando o e-mail de entrega foi enviado com sucesso via Resend';
