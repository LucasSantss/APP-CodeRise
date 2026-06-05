/**
 * api/_retry.js — Retry com back-off exponencial + Circuit Breaker
 *
 * Uso:
 *   import { withRetry, suriRequest } from "./_retry.js";
 *   const result = await withRetry(() => suriRequest(ep, tk, "POST", "/path", body));
 */

// ─── Circuit Breaker por endpoint ─────────────────────────────────────────────
const circuits = new Map();
// Estados: CLOSED (normal) → OPEN (falhou) → HALF_OPEN (testando)
const CB_THRESHOLD  = 5;     // falhas consecutivas para abrir
const CB_TIMEOUT_MS = 30000; // 30s em OPEN antes de tentar HALF_OPEN

function getCircuit(key) {
  if (!circuits.has(key)) {
    circuits.set(key, { state: "CLOSED", failures: 0, nextAttempt: 0 });
  }
  return circuits.get(key);
}

function recordSuccess(key) {
  const c = getCircuit(key);
  c.failures = 0;
  c.state = "CLOSED";
}

function recordFailure(key) {
  const c = getCircuit(key);
  c.failures++;
  if (c.failures >= CB_THRESHOLD) {
    c.state = "OPEN";
    c.nextAttempt = Date.now() + CB_TIMEOUT_MS;
  }
}

function isCircuitOpen(key) {
  const c = getCircuit(key);
  if (c.state === "CLOSED") return false;
  if (c.state === "OPEN") {
    if (Date.now() >= c.nextAttempt) {
      c.state = "HALF_OPEN";
      return false; // Permite uma tentativa
    }
    return true;
  }
  return false; // HALF_OPEN: permite
}

export function getCircuitStatus(key) {
  return circuits.get(key) || { state: "CLOSED", failures: 0 };
}

// ─── withRetry ────────────────────────────────────────────────────────────────
/**
 * @param {() => Promise<any>} fn        Função a executar
 * @param {object}             opts
 * @param {number}             opts.retries    Máximo de retries (default 3)
 * @param {number}             opts.baseMs     Back-off inicial em ms (default 1000)
 * @param {string}             opts.circuitKey Chave para o circuit breaker (default "default")
 * @param {(err: Error) => boolean} opts.shouldRetry  Retorna false para não-retriable
 */
export async function withRetry(fn, opts = {}) {
  const {
    retries    = 3,
    baseMs     = 1000,
    circuitKey = "default",
    shouldRetry = (err) => {
      // Não retenta erros de autenticação ou recurso não encontrado
      const msg = err.message || "";
      if (msg.includes("HTTP 401") || msg.includes("HTTP 403") || msg.includes("HTTP 404")) return false;
      return true;
    },
  } = opts;

  if (isCircuitOpen(circuitKey)) {
    throw new Error(`Circuit breaker OPEN para ${circuitKey}. Aguardando recuperação.`);
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      recordSuccess(circuitKey);
      return result;
    } catch (err) {
      lastErr = err;

      if (!shouldRetry(err) || attempt === retries) {
        recordFailure(circuitKey);
        throw err;
      }

      // Back-off exponencial com jitter: 1s, 3s, 9s ± 10%
      const delay = baseMs * Math.pow(3, attempt) * (0.9 + Math.random() * 0.2);
      console.warn(
        `[retry] Tentativa ${attempt + 1}/${retries} falhou: ${err.message}. Aguardando ${Math.round(delay)}ms...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── suriRequest com retry embutido ──────────────────────────────────────────
export async function suriRequestWithRetry(endpoint, token, method, path, body, retries = 2) {
  const base = (endpoint || "").replace(/\/+$/, "");
  const circuitKey = `suri:${base}`;

  return withRetry(
    async () => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          "Content-Type":  "application/json",
          "Accept":        "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000), // 15s timeout por tentativa
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(`Suri ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data)}`);
      return data;
    },
    { retries, circuitKey }
  );
}
