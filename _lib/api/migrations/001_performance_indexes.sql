-- ============================================================
-- Migration 001 — Índices de performance
-- Execute no seu banco PostgreSQL após o deploy
-- Comando: psql $DATABASE_URL -f api/migrations/001_performance_indexes.sql
-- ============================================================

-- Índice no event_id dentro do JSONB (deduplicação de webhooks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_event_id
  ON user_webhooks ((payload->>'_event_id'))
  WHERE status = 'processed';

-- Índice composto para listagem paginada por usuário
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_user_received
  ON user_webhooks (user_id, received_at DESC);

-- Índice para filtro por status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_user_status
  ON user_webhooks (user_id, status);

-- Índice para filtro por tipo de evento
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_user_event_type
  ON user_webhooks (user_id, event_type);

-- Índice para cursor-based pagination
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_user_id_desc
  ON user_webhooks (user_id, id DESC);

-- Índice nos tokens de autenticação (busca em todo login/webhook)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_token
  ON users (token) WHERE token IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_integrations_webhook_token
  ON user_integrations (webhook_token) WHERE webhook_token IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_integrations_chatbot_token
  ON user_integrations (chatbot_token) WHERE chatbot_token IS NOT NULL;
