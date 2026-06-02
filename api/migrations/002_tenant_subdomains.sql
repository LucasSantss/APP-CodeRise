ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_slug VARCHAR(63) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_domain VARCHAR(255) UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_slug_idx
  ON users (tenant_slug)
  WHERE tenant_slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_domain_idx
  ON users (tenant_domain)
  WHERE tenant_domain IS NOT NULL;

