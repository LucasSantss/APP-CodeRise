/**
 * api/_lib/carriers/correios.js
 *
 * Integração com o Correios API (Token, Preço e Prazo) para cotação de frete.
 * Referência: manual-para-integracao-correios-api (DINEG/SUCAN/DEDIG, v2.4).
 *
 * Usado por:
 *  - api/_lib/test-logistics.js  → valida usuário/senha/cartão de postagem
 *  - api/_lib/logistics-quote.js → calcula as opções de frete (SEDEX/PAC) para
 *    um pedido, no formato ShopLogistic esperado pela integração de Logística
 *    da Suri (documentacao_api_logistica.pdf).
 */

// Cache simples de token em memória (processo Node persistente na Hostinger —
// não existe em ambiente serverless, mas aqui evita gerar um token novo a
// cada cotação). Chave = credenciais; valor = { token, expiraEm }.
const tokenCache = new Map();

function baseUrl(ambiente) {
  return ambiente === "producao" ? "https://api.correios.com.br" : "https://apihom.correios.com.br";
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function cacheKey(config) {
  return [config.ambiente, config.usuario, config.cartaoPostagem].join("|");
}

/** Gera (ou reaproveita) o token de autenticação do Correios via cartão de postagem. */
export async function getCorreiosToken(config, { force = false } = {}) {
  const { usuario, senha, cartaoPostagem } = config || {};
  if (!usuario || !senha || !cartaoPostagem) {
    throw new Error("Usuário, senha do componente e cartão de postagem são obrigatórios.");
  }

  const key = cacheKey(config);
  const cached = tokenCache.get(key);
  if (!force && cached && new Date(cached.expiraEm).getTime() - Date.now() > 5 * 60 * 1000) {
    return cached;
  }

  const auth = Buffer.from(`${usuario}:${senha}`).toString("base64");
  const res = await fetch(`${baseUrl(config.ambiente)}/token/v1/autentica/cartaopostagem`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Basic ${auth}` },
    body: JSON.stringify({ numero: String(cartaoPostagem) }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Credenciais inválidas (HTTP ${res.status}). Verifique usuário e senha do componente.`);
  }
  if (!res.ok || !body.token) {
    const detail = body.msgs?.[0] || body.mensagem || body.message || JSON.stringify(body).slice(0, 200);
    throw new Error(`Correios retornou HTTP ${res.status}: ${detail}`);
  }

  const result = { token: body.token, expiraEm: body.expiraEm };
  tokenCache.set(key, result);
  return result;
}

function clampBoxDims({ comprimento, largura, altura }) {
  // Mínimos exigidos pelos Correios para uma embalagem tipo caixa/pacote.
  return {
    comprimento: Math.max(16, Math.round(comprimento || 0)),
    largura: Math.max(11, Math.round(largura || 0)),
    altura: Math.max(2, Math.round(altura || 0)),
  };
}

function aggregatePackage(items = []) {
  let totalWeight = 0;
  let comprimento = 0;
  let largura = 0;
  let altura = 0;

  for (const item of items) {
    const qty = Number(item.productQuantity ?? item.ProductQuantity ?? 1) || 1;
    const m = item.measures || item.Measures || {};
    const weight = Number(m.WeightInGrams ?? m.weightInGrams ?? 0) || 0;
    totalWeight += weight * qty;
    comprimento = Math.max(comprimento, Number(m.LengthInCm ?? m.lengthInCm ?? 0) || 0);
    largura = Math.max(largura, Number(m.WidthInCm ?? m.widthInCm ?? 0) || 0);
    // Empilha as alturas — aproximação razoável para uma única embalagem.
    altura += (Number(m.HeightInCm ?? m.heightInCm ?? 0) || 0) * qty;
  }

  return { psObjeto: Math.max(1, Math.round(totalWeight)), ...clampBoxDims({ comprimento, largura, altura }) };
}

const SERVICE_LABELS = { sedex: "SEDEX", pac: "PAC" };

function configuredServices(config) {
  const list = [];
  if (config.codigoServicoSedex) list.push({ key: "sedex", code: String(config.codigoServicoSedex) });
  if (config.codigoServicoPac) list.push({ key: "pac", code: String(config.codigoServicoPac) });
  return list;
}

async function fetchPrecoPrazo({ ambiente, token, coProduto, cepOrigem, cepDestino, pkg }) {
  const host = baseUrl(ambiente);
  const headers = { "Accept": "application/json", "Authorization": `Bearer ${token}` };
  const precoUrl = `${host}/preco/v1/nacional/${coProduto}` +
    `?cepDestino=${cepDestino}&cepOrigem=${cepOrigem}&psObjeto=${pkg.psObjeto}&tpObjeto=2` +
    `&comprimento=${pkg.comprimento}&largura=${pkg.largura}&altura=${pkg.altura}`;
  const prazoUrl = `${host}/prazo/v1/nacional/${coProduto}?cepOrigem=${cepOrigem}&cepDestino=${cepDestino}`;

  const [precoRes, prazoRes] = await Promise.all([
    fetch(precoUrl, { headers, signal: AbortSignal.timeout(10000) }),
    fetch(prazoUrl, { headers, signal: AbortSignal.timeout(10000) }),
  ]);
  const preco = await precoRes.json().catch(() => ({}));
  const prazo = await prazoRes.json().catch(() => ({}));

  if (!precoRes.ok) throw new Error(preco?.msgs?.[0] || preco?.causa || preco?.txMsg || `Preço (${coProduto}) retornou HTTP ${precoRes.status}`);
  if (!prazoRes.ok) throw new Error(prazo?.msgs?.[0] || prazo?.causa || prazo?.txMsg || `Prazo (${coProduto}) retornou HTTP ${prazoRes.status}`);
  return { preco, prazo };
}

/**
 * Calcula as opções de entrega (SEDEX/PAC) para um pedido, no formato
 * ShopLogistic[] esperado pela integração de Logística da Suri.
 */
export async function getShippingOptions(config, request) {
  const items = request?.Items || request?.items || [];
  const address = request?.Address || request?.address || {};
  const cepDestino = onlyDigits(address.ZipCode ?? address.zipCode);
  const cepOrigem = onlyDigits(config.cepOrigem);

  if (!cepOrigem) throw new Error("Configure o CEP de origem na integração de Logística.");
  if (!cepDestino) throw new Error("CEP de destino não informado no pedido.");

  const services = configuredServices(config);
  if (!services.length) throw new Error("Nenhum serviço dos Correios configurado (SEDEX/PAC).");

  const pkg = aggregatePackage(items);
  const { token } = await getCorreiosToken(config);

  const settled = await Promise.allSettled(
    services.map(async (svc) => {
      const { preco, prazo } = await fetchPrecoPrazo({ ambiente: config.ambiente, token, coProduto: svc.code, cepOrigem, cepDestino, pkg });
      const rawPrice = String(preco.pcFinal ?? preco.pcFaixaVariacao ?? preco.pcReferencia ?? "0").replace(",", ".");
      const price = parseFloat(rawPrice);
      return {
        ProviderId: `correios-${svc.key}`,
        Name: SERVICE_LABELS[svc.key] || svc.key.toUpperCase(),
        FromSellerId: config.fromSellerId || "default",
        Type: 1, // Entrega
        Price: Number.isFinite(price) ? Number(price.toFixed(2)) : 0,
        Description: `Prazo estimado: ${prazo.prazoEntrega} dia(s) útil(eis)`,
        CompanyName: "Correios",
        ShippingTimeEstimative: `${prazo.prazoEntrega} dia(s) útil(eis)`,
        ShippingEstimativeDate: prazo.dataMaxima,
      };
    })
  );

  return settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
}
