/**
 * parseApiError.ts
 * Converte mensagens de erro técnicas da API Suri / e-commerce
 * em mensagens amigáveis em português para exibição na UI.
 */

interface ParsedError {
  title: string;
  description: string;
  hint?: string;
}

const SURI_BRAND_REGEX = /Error converting value .+ to type ['"]ChatbotMaker\.BDK\.Models\.Shop\.ShopBrand['"]/i;
const SURI_CATEGORY_REGEX = /Error converting value .+ to type ['"]ChatbotMaker\.BDK\.Models\.Shop\.ShopCategory['"]/i;
const SURI_SKU_REGEX = /sku|Stock Keeping Unit/i;
const HTTP_STATUS_REGEX = /HTTP (\d{3})/;

export function parseApiError(raw: string, context?: 'product' | 'category' | 'general'): ParsedError {
  const msg = raw || '';

  // ── Erros de validação Suri ───────────────────────────────────────────────
  if (SURI_BRAND_REGEX.test(msg)) {
    const brandMatch = msg.match(/converting value \\"?([^"\\]+)\\"? to type/i);
    const brandValue = brandMatch?.[1] ?? 'desconhecida';
    return {
      title: 'Marca do produto inválida',
      description: `O valor de marca "${brandValue}" não está cadastrado na Suri.`,
      hint: 'Cadastre a marca na Suri antes de sincronizar, ou deixe o campo "brand" vazio no e-commerce.',
    };
  }

  if (SURI_CATEGORY_REGEX.test(msg)) {
    return {
      title: 'Categoria inválida',
      description: 'A categoria referenciada não existe na Suri.',
      hint: 'Sincronize as categorias antes de sincronizar os produtos.',
    };
  }

  // ── Erros HTTP por status ─────────────────────────────────────────────────
  const statusMatch = msg.match(HTTP_STATUS_REGEX);
  const status = statusMatch ? parseInt(statusMatch[1]) : null;

  if (status === 400) {
    // Tenta extrair o campo com problema
    const fieldMatch = msg.match(/Path '([^']+)'/i);
    const field = fieldMatch?.[1];
    if (field) {
      const fieldLabel = fieldLabels[field] ?? field;
      return {
        title: 'Dado inválido',
        description: `Campo "${fieldLabel}" contém um valor que a Suri não aceita.`,
        hint: 'Verifique o valor deste campo no e-commerce e ajuste antes de sincronizar.',
      };
    }
    return {
      title: 'Requisição inválida (400)',
      description: 'A Suri rejeitou os dados enviados.',
      hint: 'Verifique se todos os campos do produto estão preenchidos corretamente.',
    };
  }

  if (status === 401) {
    return {
      title: 'Sem autorização (401)',
      description: 'O token da Suri é inválido ou expirou.',
      hint: 'Atualize o token de acesso na aba Chatbot e tente novamente.',
    };
  }

  if (status === 403) {
    return {
      title: 'Acesso negado (403)',
      description: 'Sua conta não tem permissão para esta operação na Suri.',
      hint: 'Verifique as permissões do usuário da API na Suri.',
    };
  }

  if (status === 404) {
    const entity = context === 'category' ? 'categoria' : context === 'product' ? 'produto' : 'recurso';
    return {
      title: `${entity.charAt(0).toUpperCase() + entity.slice(1)} não encontrado(a) (404)`,
      description: `O(A) ${entity} não existe na Suri.`,
      hint: 'Será criado(a) automaticamente na próxima sincronização.',
    };
  }

  if (status === 409) {
    return {
      title: 'Conflito de dados (409)',
      description: 'Um registro com este ID já existe na Suri.',
      hint: 'O sistema tentará atualizar o registro automaticamente.',
    };
  }

  if (status === 422) {
    return {
      title: 'Dados não processáveis (422)',
      description: 'A Suri não conseguiu processar os dados enviados.',
      hint: 'Verifique se todas as variantes e atributos do produto estão corretos.',
    };
  }

  if (status === 429) {
    return {
      title: 'Limite de requisições atingido (429)',
      description: 'Muitas requisições foram feitas em pouco tempo.',
      hint: 'Aguarde alguns minutos e tente sincronizar novamente.',
    };
  }

  if (status === 500 || status === 502 || status === 503) {
    return {
      title: 'Erro no servidor da Suri',
      description: `O servidor da Suri retornou um erro interno (${status}).`,
      hint: 'Tente novamente em alguns minutos. Se persistir, contate o suporte.',
    };
  }

  // ── Erros de rede / timeout ───────────────────────────────────────────────
  if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('aborterror')) {
    return {
      title: 'Tempo limite esgotado',
      description: 'A Suri não respondeu dentro do tempo esperado.',
      hint: 'Verifique sua conexão e se a Suri está online.',
    };
  }

  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) {
    return {
      title: 'Falha de conexão',
      description: 'Não foi possível conectar à Suri.',
      hint: 'Verifique se o endpoint está correto e acessível.',
    };
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  // Tenta truncar a mensagem técnica para não ser tão assustadora
  const truncated = msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
  return {
    title: 'Erro ao sincronizar',
    description: truncated || 'Erro desconhecido.',
  };
}

// Mapeamento de nomes de campos técnicos para labels legíveis
const fieldLabels: Record<string, string> = {
  'brand': 'Marca',
  'categoryId': 'Categoria',
  'subcategoryId': 'Subcategoria',
  'sku': 'SKU',
  'price': 'Preço',
  'name': 'Nome',
  'description': 'Descrição',
  'isActive': 'Status ativo',
  'sellerId': 'Vendedor',
  'weightInGrams': 'Peso (g)',
  'heightInCm': 'Altura (cm)',
  'widthInCm': 'Largura (cm)',
  'lengthInCm': 'Comprimento (cm)',
};

/**
 * Retorna apenas a descrição amigável para uso em listas compactas (ex: resultado de sync).
 */
export function friendlyErrorMessage(raw: string, context?: 'product' | 'category' | 'general'): string {
  const parsed = parseApiError(raw, context);
  return parsed.hint
    ? `${parsed.description} ${parsed.hint}`
    : parsed.description;
}
