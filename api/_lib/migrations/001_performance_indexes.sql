-- ============================================================
-- Migration 001 — Índices de performance (versão MySQL)
-- Execute manualmente no banco MySQL da Hostinger (phpMyAdmin ou
-- `mysql -h host -u usuario -p nome_do_banco < 001_performance_indexes.sql`)
--
-- MySQL não tem CREATE INDEX CONCURRENTLY nem IF NOT EXISTS pra índice, nem
-- índice parcial (WHERE) — cada CREATE INDEX abaixo falha com erro se rodar
-- duas vezes (índice já existe); é seguro ignorar esse erro específico.
-- ============================================================

-- Índice no event_id dentro do JSON (deduplicação de webhooks). MySQL não
-- indexa expressão + filtro WHERE como o Postgres, então usamos uma coluna
-- gerada (STORED) e indexamos ela junto com status.
ALTER TABLE user_webhooks
  ADD COLUMN event_id_extracted VARCHAR(255)
  GENERATED ALWAYS AS (payload->>'$._event_id') STORED;

CREATE INDEX idx_webhooks_event_id
  ON user_webhooks (event_id_extracted, status);

-- Índice composto para listagem paginada por usuário
CREATE INDEX idx_webhooks_user_received
  ON user_webhooks (user_id, received_at DESC);

-- Índice para filtro por status
CREATE INDEX idx_webhooks_user_status
  ON user_webhooks (user_id, status);

-- Índice para filtro por tipo de evento
CREATE INDEX idx_webhooks_user_event_type
  ON user_webhooks (user_id, event_type);

-- Índice para cursor-based pagination
CREATE INDEX idx_webhooks_user_id_desc
  ON user_webhooks (user_id, id DESC);

-- Os índices únicos em users.token / user_integrations.webhook_token /
-- user_integrations.chatbot_token já existem via UNIQUE na própria coluna
-- (definida em setup.js) — não precisam de índice extra aqui, diferente da
-- versão Postgres original (que tinha índice único parcial redundante).
