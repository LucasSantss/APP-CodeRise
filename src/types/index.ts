export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  active: boolean;
  tenant_slug?: string | null;
  tenant_domain?: string | null;
  token?: string;
  created_at: string;
  updated_at: string;
}

export interface UserIntegration {
  id: number;
  user_id: number;
  // E-commerce
  ecommerce_platform: EcommercePlatform | null;
  ecommerce_config: Record<string, string> | null;
  ecommerce_active: boolean;
  webhook_token: string;
  // Chatbot (separado)
  chatbot_platform: ChatbotPlatform | null;
  chatbot_config: Record<string, string> | null;
  chatbot_active: boolean;
  chatbot_token: string | null;
  // Legado
  suri_endpoint: string | null;
  suri_token: string | null;
  suri_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatbotIntegration {
  chatbot_platform: ChatbotPlatform | null;
  chatbot_config: Record<string, string> | null;
  chatbot_active: boolean;
  chatbot_token: string | null;
  created_at: string;
  updated_at: string;
}

export type EcommercePlatform = 'shopify' | 'woocommerce' | 'tray' | 'nuvemshop' | 'vtex' | 'custom';
export type ChatbotPlatform = 'suri' | 'evolution_api' | 'kommo' | 'take_blip' | 'manychat' | 'weni';

export interface SyncRule {
  id: number;
  user_id: number;
  event: SyncEvent;
  active: boolean;
  message_template: string | null;
  delay_minutes: number;
  created_at: string;
  updated_at: string;
}

export type SyncEvent = 'order.created' | 'order.shipped' | 'order.cancelled' | 'cart.abandoned' | 'customer.created';

export interface WebhookEvent {
  id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  event_type: string | null;
  payload: Record<string, unknown> | null;
  status: 'received' | 'processed' | 'error';
  error_message: string | null;
  received_at: string;
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: User;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

// ─── Chatbot platforms ───────────────────────────────────────────────────────

export const CHATBOT_FIELDS: Record<ChatbotPlatform, { label: string; fields: { key: string; label: string; type?: string; placeholder?: string }[] }> = {
  suri: {
    label: 'Suri',
    fields: [
      { key: 'endpoint', label: 'Endpoint da API', placeholder: 'https://xxx.azurewebsites.net/api' },
      { key: 'token',    label: 'Bearer Token',    type: 'password', placeholder: 'Token de autenticação' },
    ],
  },
  evolution_api: {
    label: 'Evolution API',
    fields: [
      { key: 'server_url',     label: 'URL do Servidor',   placeholder: 'https://evolution.seudominio.com' },
      { key: 'api_key',        label: 'API Key',           type: 'password', placeholder: 'Chave de autenticação' },
      { key: 'instance_name', label: 'Nome da Instância',  placeholder: 'minha-instancia' },
    ],
  },
  kommo: {
    label: 'Kommo',
    fields: [
      { key: 'account_domain', label: 'Domínio da Conta',  placeholder: 'suaconta.kommo.com' },
      { key: 'access_token',   label: 'Access Token',      type: 'password', placeholder: 'Token OAuth' },
      { key: 'pipeline_id',    label: 'Pipeline ID',       placeholder: 'ID do funil (opcional)' },
    ],
  },
  take_blip: {
    label: 'Take Blip',
    fields: [
      { key: 'bot_identifier', label: 'Identificador do Bot', placeholder: 'meubot' },
      { key: 'authorization',  label: 'Authorization Key',    type: 'password', placeholder: 'Chave de autorização' },
    ],
  },
  manychat: {
    label: 'ManyChat',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'Chave da API ManyChat' },
    ],
  },
  weni: {
    label: 'Weni',
    fields: [
      { key: 'org_uuid',    label: 'UUID da Organização', placeholder: 'UUID da sua org' },
      { key: 'flow_uuid',   label: 'UUID do Flow',        placeholder: 'UUID do flow a disparar' },
      { key: 'access_token', label: 'Access Token',       type: 'password', placeholder: 'Token de acesso' },
    ],
  },
};

// ─── E-commerce platforms ────────────────────────────────────────────────────

export const ECOMMERCE_FIELDS: Record<EcommercePlatform, { label: string; fields: { key: string; label: string; type?: string }[] }> = {
  shopify: {
    label: 'Shopify',
    fields: [
      { key: 'store_url',   label: 'URL da Loja (ex: minha-loja.myshopify.com)' },
      { key: 'api_token',   label: 'API Token',               type: 'password' },
      { key: 'api_version', label: 'API Version (ex: 2024-01)' },
    ],
  },
  woocommerce: {
    label: 'WooCommerce',
    fields: [
      { key: 'site_url',        label: 'URL do Site' },
      { key: 'consumer_key',    label: 'Consumer Key',    type: 'password' },
      { key: 'consumer_secret', label: 'Consumer Secret', type: 'password' },
    ],
  },
  tray: {
    label: 'Tray',
    fields: [
      { key: 'api_address',  label: 'Endereço da API' },
      { key: 'access_token', label: 'Access Token', type: 'password' },
    ],
  },
  nuvemshop: {
    label: 'Nuvemshop',
    fields: [
      { key: 'store_id',     label: 'Store ID' },
      { key: 'access_token', label: 'Access Token', type: 'password' },
    ],
  },
  vtex: {
    label: 'VTEX',
    fields: [
      { key: 'account_name', label: 'Account Name' },
      { key: 'app_key',      label: 'App Key',   type: 'password' },
      { key: 'app_token',    label: 'App Token', type: 'password' },
      { key: 'environment',  label: 'Environment' },
    ],
  },
  custom: {
    label: 'Custom',
    fields: [
      { key: 'name',               label: 'Nome da Plataforma' },
      { key: 'base_url',           label: 'Base URL' },
      { key: 'auth_header_name',   label: 'Nome do Header de Auth' },
      { key: 'auth_header_value',  label: 'Valor do Header de Auth', type: 'password' },
    ],
  },
};

export const SYNC_EVENTS: { value: SyncEvent; label: string }[] = [
  { value: 'order.created',    label: 'Pedido Criado' },
  { value: 'order.shipped',    label: 'Pedido Enviado' },
  { value: 'order.cancelled',  label: 'Pedido Cancelado' },
  { value: 'cart.abandoned',   label: 'Carrinho Abandonado' },
  { value: 'customer.created', label: 'Cliente Criado' },
];

export const TEMPLATE_VARIABLES = [
  '{{customer_name}}',
  '{{customer_phone}}',
  '{{order_id}}',
  '{{order_total}}',
  '{{tracking_code}}',
];
