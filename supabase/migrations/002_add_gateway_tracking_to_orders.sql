-- ============================================================
-- SmartCheckout Engine — Migration 002
-- Adiciona rastreamento de transacao externa e provider do gateway.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS external_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_orders_external_transaction_id
  ON orders (external_transaction_id);

CREATE INDEX IF NOT EXISTS idx_orders_payment_provider
  ON orders (payment_provider);

COMMENT ON COLUMN orders.payment_provider IS 'Gateway utilizado no pagamento: asaas | appmax | outros';
COMMENT ON COLUMN orders.external_transaction_id IS 'ID da transacao retornado pelo gateway de pagamento';
COMMENT ON COLUMN orders.gateway_payload IS 'Payload bruto resumido retornado pelo gateway para auditoria';
