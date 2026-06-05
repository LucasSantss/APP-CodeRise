-- ============================================================
-- Migração 002: Multi-tenant (subdomínios) + Fila de Jobs
-- ============================================================

-- ─── Tabela de slugs/subdomínios por cliente ──────────────────
CREATE TABLE IF NOT EXISTS tenant_slugs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          VARCHAR(50) UNIQUE NOT NULL,          -- ex: "loja-da-maria"
  custom_domain TEXT,                                  -- ex: "api.lojadamaria.com.br"
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índices para lookup rápido
CREATE INDEX IF NOT EXISTS idx_tenant_slugs_slug    ON tenant_slugs(slug);
CREATE INDEX IF NOT EXISTS idx_tenant_slugs_user_id ON tenant_slugs(user_id);

-- ─── Fila de processamento assíncrono ────────────────────────
CREATE TABLE IF NOT EXISTS processing_queue (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type    VARCHAR(50) NOT NULL,                   -- "webhook.process", "catalog.sync"
  payload     JSONB NOT NULL DEFAULT '{}',
  status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  priority    INTEGER NOT NULL DEFAULT 0,             -- maior = primeiro
  retries     INTEGER NOT NULL DEFAULT 0,
  worker_id   VARCHAR(50),                            -- região Vercel que pegou o job
  error       TEXT,
  result      JSONB,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at  TIMESTAMP,
  finished_at TIMESTAMP
);

-- Índice para o worker query (FOR UPDATE SKIP LOCKED)
CREATE INDEX IF NOT EXISTS idx_queue_pending
  ON processing_queue(status, priority DESC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_queue_user_id ON processing_queue(user_id);

-- ─── Índice de performance em user_webhooks (já existia em 001, garante aqui) ─
CREATE INDEX IF NOT EXISTS idx_user_webhooks_user_id_received
  ON user_webhooks(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_webhooks_status
  ON user_webhooks(status) WHERE status = 'pending';

-- ─── Função + trigger para updated_at automático ─────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tenant_slugs_updated_at') THEN
    CREATE TRIGGER trg_tenant_slugs_updated_at
      BEFORE UPDATE ON tenant_slugs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─── Expiração de token de sessão ───────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP;

-- Define expiração de 30 dias para tokens existentes
UPDATE users SET token_expires_at = NOW() + INTERVAL '30 days' WHERE token IS NOT NULL AND token_expires_at IS NULL;

-- Índice para lookup de token ativo
CREATE INDEX IF NOT EXISTS idx_users_token ON users(token) WHERE token IS NOT NULL;
