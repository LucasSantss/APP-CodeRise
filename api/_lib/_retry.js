// Circuit breaker por endpoint
const circuits = new Map();
const CB_THRESHOLD  = 5;
const CB_TIMEOUT_MS = 30000;

function getCircuit(key) {
  if (!circuits.has(key)) circuits.set(key, { state: "CLOSED", failures: 0, nextAttempt: 0 });
  return circuits.get(key);
}
function recordSuccess(key) { const c = getCircuit(key); c.failures = 0; c.state = "CLOSED"; }
function recordFailure(key) {
  const c = getCircuit(key); c.failures++;
  if (c.failures >= CB_THRESHOLD) { c.state = "OPEN"; c.nextAttempt = Date.now() + CB_TIMEOUT_MS; }
}
function isCircuitOpen(key) {
  const c = getCircuit(key);
  if (c.state === "CLOSED") return false;
  if (c.state === "OPEN" && Date.now() >= c.nextAttempt) { c.state = "HALF_OPEN"; return false; }
  return c.state === "OPEN";
}

export async function withRetry(fn, opts = {}) {
  const {
    retries    = 3,
    baseMs     = 1000,
    circuitKey = "default",
    shouldRetry = (err) => !err.message?.includes("HTTP 401") && !err.message?.includes("HTTP 403") && !err.message?.includes("HTTP 404"),
  } = opts;

  if (isCircuitOpen(circuitKey)) throw new Error(`Circuit breaker OPEN para ${circuitKey}`);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      recordSuccess(circuitKey);
      return result;
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err) || attempt === retries) { recordFailure(circuitKey); throw err; }
      const delay = baseMs * Math.pow(3, attempt) * (0.9 + Math.random() * 0.2);
      console.warn(`[retry] Tentativa ${attempt + 1}/${retries}: ${err.message}. Aguardando ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// suriRequest com retry embutido
export async function suriRequestWithRetry(endpoint, token, method, path, body, retries = 2) {
  const base = (endpoint || "").replace(/\/+$/, "");
  return withRetry(async () => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(`Suri ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }, { retries, circuitKey: `suri:${base}` });
}
