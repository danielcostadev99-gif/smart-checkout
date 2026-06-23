-- ============================================================
-- SmartCheckout Engine — Migration 003
-- Cria tabela webhook_events para persistir eventos de webhook do gateway
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT,
  event_type TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events (event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status_received_at ON webhook_events (status, received_at);

COMMENT ON COLUMN webhook_events.payload IS 'Payload bruto do evento enviado pelo gateway';
COMMENT ON COLUMN webhook_events.event_id IS 'ID do evento fornecido pelo gateway (para idempotencia)';
COMMENT ON COLUMN webhook_events.status IS 'pending | processing | processed | failed';
*** End Patch