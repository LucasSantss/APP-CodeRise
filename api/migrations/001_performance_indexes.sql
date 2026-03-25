-- ============================================================
-- Migration 001 — Índices de performance
-- Compatível com Neon Serverless (sem CONCURRENTLY)
--
-- Neon não suporta CREATE INDEX CONCURRENTLY porque esse comando
-- exige uma conexão persistente dedicada — incompatível com o
-- modelo de conexões HTTP stateless do Neon.
--
-- Como rodar:
--   psql $DATABASE_URL -f api/migrations/001_performance_indexes.sql
--
-- Ou cole direto no SQL Editor do painel neon.tech
-- ============================================================

-- 1. Deduplicação de eventos (isDuplicateEvent)
--    Cobre: WHERE status='processed' AND payload->>'_event_id' = $1
CREATE INDEX IF NOT EXISTS idx_webhooks_event_id
  ON user_webhooks ((payload->>'_event_id'))
  WHERE status = 'processed';

-- 2. Listagem paginada por usuário ordenada por data (query principal)
--    Cobre: WHERE user_id = $1 ORDER BY received_at DESC
CREATE INDEX IF NOT EXISTS idx_webhooks_user_received
  ON user_webhooks (user_id, received_at DESC);

-- 3. Filtro por status (tela de Logs)
--    Cobre: WHERE user_id = $1 AND status = $2
CREATE INDEX IF NOT EXISTS idx_webhooks_user_status
  ON user_webhooks (user_id, status);

-- 4. Filtro por tipo de evento (tela de Logs)
--    Cobre: WHERE user_id = $1 AND event_type = $2
CREATE INDEX IF NOT EXISTS idx_webhooks_user_event_type
  ON user_webhooks (user_id, event_type);

-- 5. Cursor-based pagination via long poll (WHERE id > $after_id)
--    Cobre: WHERE user_id = $1 AND id > $2
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id_desc
  ON user_webhooks (user_id, id DESC);

-- 6. Busca de usuário por token (login e middleware de auth)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_token
  ON users (token)
  WHERE token IS NOT NULL;

-- 7. Lookup de token de webhook (toda requisição de entrada)
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_webhook_token
  ON user_integrations (webhook_token)
  WHERE webhook_token IS NOT NULL;

-- 8. Lookup de token de chatbot (toda requisição de entrada)
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_chatbot_token
  ON user_integrations (chatbot_token)
  WHERE chatbot_token IS NOT NULL;
