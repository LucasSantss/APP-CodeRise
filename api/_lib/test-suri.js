import pool from "./db.js";
import { requireAuth } from "../_auth.js";

export async function handleTestSuri(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow",["POST"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res); if (!caller) return;
  const { endpoint, token } = req.body || {};
  if (!endpoint||typeof endpoint!=="string"||!endpoint.trim()) return res.status(400).json({success:false,message:"URL do Chatbot é obrigatória."});
  if (!token||typeof token!=="string"||!token.trim()) return res.status(400).json({success:false,message:"Token de Integração é obrigatório."});
  let base;
  try { base=new URL(endpoint.trim().replace(/\/$/,"")); } catch { return res.status(400).json({success:false,message:`URL inválida: "${endpoint}". Verifique se começa com https://`}); }
  if (base.protocol!=="https:"&&base.protocol!=="http:") return res.status(400).json({success:false,message:"A URL deve começar com https:// ou http://"});
  const uuidRegex=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tokenClean=token.trim();
  if (!uuidRegex.test(tokenClean)) return res.status(400).json({success:false,message:"Formato de token inválido. O Token de Integração da Suri deve ser um UUID."});

  const notifyAdminError = async (errorMsg) => {
    try {
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
      const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [caller.id]);
      const userName = uRow.rows[0]?.name || `ID ${caller.id}`;
      const intRow = await pool.query("SELECT chatbot_platform FROM user_integrations WHERE user_id = $1", [caller.id]);
      const rawPlatform = intRow.rows[0]?.chatbot_platform || "suri";
      const PLATFORM_LABELS = { suri:"Suri", evolution_api:"Evolution API", kommo:"Kommo" };
      const platformLabel = PLATFORM_LABELS[rawPlatform] || rawPlatform;
      await pool.query("INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')", [`Falha no teste de conexão — ${platformLabel}`, `Perfil: ${userName}\nPlataforma: ${platformLabel}\nURL: ${base?.hostname || endpoint}\nHorário: ${errorTime}\n\nDetalhe: ${errorMsg}`]);
      await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(() => {});
    } catch {}
  };

  let httpStatus, body;
  try {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),10000);
    const upstream=await fetch(`${base.origin}/api/shop/stores`,{method:"GET",headers:{Authorization:`Bearer ${tokenClean}`,Accept:"application/json","Content-Type":"application/json"},signal:controller.signal});
    clearTimeout(timeout);
    httpStatus=upstream.status;
    const text=await upstream.text();
    try { body=JSON.parse(text); } catch { body={raw:text}; }
  } catch (err) {
    const msg = err.name==="AbortError"?`Timeout: "${base.hostname}" não respondeu em 10s.`:`Não foi possível conectar em "${base.hostname}": ${err.message}`;
    await notifyAdminError(msg);
    return res.status(502).json({success:false,message:msg});
  }
  if (httpStatus===401||httpStatus===403) { await notifyAdminError(`Token inválido ou sem permissão (HTTP ${httpStatus}).`); return res.status(200).json({success:false,httpStatus,message:`Token inválido ou sem permissão (HTTP ${httpStatus}).`}); }
  if (httpStatus===404) { await notifyAdminError(`Rota não encontrada (HTTP 404). Verifique a URL do Chatbot.`); return res.status(200).json({success:false,httpStatus,message:`Rota não encontrada (HTTP 404). Verifique a URL do Chatbot.`}); }
  if (httpStatus<200||httpStatus>=300) { await notifyAdminError(`Servidor retornou HTTP ${httpStatus}.`); return res.status(200).json({success:false,httpStatus,message:`Servidor retornou HTTP ${httpStatus}.`}); }
  const hasValidBody=Array.isArray(body)||(body&&typeof body==="object"&&!body.raw)||(body&&Array.isArray(body.data));
  if (!hasValidBody||body?.raw!==undefined) { await notifyAdminError(`Servidor respondeu HTTP ${httpStatus} mas body inesperado.`); return res.status(200).json({success:false,httpStatus,message:`Servidor respondeu HTTP ${httpStatus} mas body inesperado. Verifique a URL.`,debug:String(body?.raw||"").slice(0,200)}); }
  const storeCount=Array.isArray(body)?body.length:Array.isArray(body?.data)?body.data.length:null;
  return res.status(200).json({success:true,httpStatus,message:storeCount!==null?`Conexão bem-sucedida! ${storeCount} loja(s) encontrada(s).`:"Conexão com a Suri realizada com sucesso!"});
}
