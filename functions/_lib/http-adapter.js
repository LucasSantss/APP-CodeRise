/**
 * Envelopa um handler no estilo Node/Vercel `(req, res) => {}` (como os que já
 * existem em api/**) e devolve uma função no formato exigido pelas Cloudflare
 * Pages Functions: `(context) => Promise<Response>`.
 *
 * Simula apenas o que os handlers existentes de fato usam (confirmado por
 * inspeção de todos os arquivos em api/): req.method, req.url, req.query,
 * req.body, req.headers, e res.status()/json()/setHeader()/end(). Nenhum deles
 * faz streaming parcial (res.write) nem upload de arquivo, então capturar a
 * resposta final após o handler resolver é suficiente — não precisamos
 * simular um socket real.
 */
export function toPagesFunction(handler) {
  return async (context) => {
    const { request, env } = context;
    const url = new URL(request.url);

    const query = {};
    for (const [key, value] of url.searchParams) query[key] = value;

    let body;
    const hasBody = !["GET", "HEAD"].includes(request.method);
    if (hasBody) {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        body = await request.json().catch(() => undefined);
      } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
        // Nenhum handler atual depende disso, mas mantemos por segurança.
        body = Object.fromEntries((await request.formData().catch(() => new FormData())).entries());
      }
    }

    const headers = {};
    for (const [key, value] of request.headers) headers[key] = value;

    const req = {
      method: request.method,
      url: url.pathname + url.search,
      query,
      body,
      headers,
      env, // exposto para handlers que precisem do binding diretamente (ex.: cron-sync-stores)
      on() {}, // no-op: nada de streaming/close a observar aqui
    };

    const responseState = { status: 200, headers: new Headers(), body: undefined, sent: false };

    const res = {
      status(code) {
        responseState.status = code;
        return res;
      },
      setHeader(name, value) {
        const values = Array.isArray(value) ? value.join(", ") : String(value);
        responseState.headers.set(name, values);
        return res;
      },
      json(payload) {
        responseState.headers.set("content-type", "application/json; charset=utf-8");
        responseState.body = JSON.stringify(payload);
        responseState.sent = true;
        return res;
      },
      end(payload) {
        if (payload !== undefined) responseState.body = payload;
        responseState.sent = true;
        return res;
      },
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error("[http-adapter] Erro não tratado no handler:", err);
      if (!responseState.sent) {
        responseState.status = 500;
        responseState.headers.set("content-type", "application/json; charset=utf-8");
        responseState.body = JSON.stringify({ success: false, message: err.message || "Erro interno" });
      }
    }

    return new Response(responseState.body, {
      status: responseState.status,
      headers: responseState.headers,
    });
  };
}
