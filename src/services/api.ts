/// <reference types="vite/client" />
import { useAuthStore } from '@/store/auth';
import type {
  User, UserIntegration, SyncRule, WebhookEvent,
  LoginResponse, ApiResponse,
} from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Erro de rede' }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// Auth
export const login = (email: string, password: string) =>
  request<LoginResponse>('/auth?action=login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const logout = () =>
  request<ApiResponse>('/auth?action=logout', { method: 'POST' });

// Users
export const getUsers = () => request<ApiResponse<User[]>>('/users');
export const getUser = (id: number) => request<ApiResponse<User>>(`/users?id=${id}`);
export const createUser = (data: Partial<User> & { password: string }) =>
  request<ApiResponse<User>>('/users', { method: 'POST', body: JSON.stringify(data) });
export const patchUser = (id: number, data: { active?: boolean; role?: string }) =>
  request<ApiResponse>(`/users?id=${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteUser = (id: number) =>
  request<ApiResponse>(`/users?id=${id}`, { method: 'DELETE' });

// Integrations
export const getIntegrations = (userId?: number) =>
  request<ApiResponse<UserIntegration | UserIntegration[]>>(userId ? `/integrations?user_id=${userId}` : '/integrations');
export const updateIntegration = (data: Partial<UserIntegration>, userId?: number) =>
  request<ApiResponse<UserIntegration>>(`/integrations${userId ? `?user_id=${userId}` : ''}`, { method: 'PUT', body: JSON.stringify(data) });
export const patchIntegration = (data: { suri_active?: boolean; ecommerce_active?: boolean }, userId?: number) =>
  request<ApiResponse>(`/integrations${userId ? `?user_id=${userId}` : ''}`, { method: 'PATCH', body: JSON.stringify(data) });

// Sync Rules
export const getSyncRules = (userId?: number) =>
  request<ApiResponse<SyncRule[]>>(`/sync-rules${userId ? `?user_id=${userId}` : ''}`);
export const createSyncRule = (data: Partial<SyncRule>, userId?: number) =>
  request<ApiResponse<SyncRule>>(`/sync-rules${userId ? `?user_id=${userId}` : ''}`, { method: 'POST', body: JSON.stringify(data) });
export const patchSyncRule = (id: number, active: boolean) =>
  request<ApiResponse>(`/sync-rules?id=${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
export const deleteSyncRule = (id: number) =>
  request<ApiResponse>(`/sync-rules?id=${id}`, { method: 'DELETE' });

// Webhooks
// `params` may include filters such as `status`, `event_type` and also `limit` to
// restrict the number of returned records (server caps at 500).
export const getWebhooks = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<ApiResponse<WebhookEvent[]>>(`/webhooks${qs}`);
};
export const deleteWebhooks = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<ApiResponse>(`/webhooks${qs}`, { method: 'DELETE' });
};

// ── Chatbot (separado do e-commerce) ─────────────────────────────────────────
export const getChatbot = (userId?: number) =>
  request<ApiResponse>(`/chatbot${userId ? `?user_id=${userId}` : ''}`);

export const updateChatbot = (data: { chatbot_platform?: string; chatbot_config?: Record<string, string> }, userId?: number) =>
  request<ApiResponse>(`/chatbot${userId ? `?user_id=${userId}` : ''}`, { method: 'PUT', body: JSON.stringify(data) });

export const patchChatbot = (chatbot_active: boolean, userId?: number) =>
  request<ApiResponse>(`/chatbot${userId ? `?user_id=${userId}` : ''}`, { method: 'PATCH', body: JSON.stringify({ chatbot_active }) });

export const regenerateChatbotToken = (userId?: number) =>
  request<ApiResponse>(`/chatbot?action=regenerate-token${userId ? `&user_id=${userId}` : ''}`, { method: 'POST' });


// Suri connection test (proxied through backend to avoid CORS)
export const testSuriConnection = (endpoint: string, token: string) =>
  request<ApiResponse & { httpStatus?: number; debug?: string }>(
    '/test-suri',
    { method: 'POST', body: JSON.stringify({ endpoint, token }) }
  );

// E-commerce connection test (proxied through backend)
export const testEcommerceConnection = (platform: string, config: Record<string, string>) =>
  request<ApiResponse & { store?: string; plan?: string; country?: string }>(
    '/test-ecommerce',
    { method: 'POST', body: JSON.stringify({ platform, config }) }
  );

// ── Notifications ─────────────────────────────────────────────────────────────
export const getNotifications = (afterId?: number) =>
  request<{ success: boolean; notifications: import('@/store/notifications').Notification[] }>(`/notifications${afterId ? `?after_id=${afterId}` : ''}`);

export const createNotification = (data: {
  type: string;
  title: string;
  message: string;
  image_url?: string;
  target_role?: string;
  target_user_id?: number;
  scheduled_at?: string;
}) =>
  request<{ success: boolean; notification: import('@/store/notifications').Notification }>(
    '/notifications',
    { method: 'POST', body: JSON.stringify(data) }
  );

export const markNotificationRead = (id: number) =>
  request<{ success: boolean }>('/notifications', {
    method: 'PATCH',
    body: JSON.stringify({ id }),
  });

export const markAllNotificationsRead = () =>
  request<{ success: boolean }>('/notifications', {
    method: 'PATCH',
    body: JSON.stringify({ mark_all: true }),
  });

export const deleteNotification = (id: number) =>
  request<{ success: boolean }>(`/notifications?id=${id}`, { method: 'DELETE' });

export const createSystemNotification = (data: {
  type: string;
  title: string;
  message: string;
  target_user_id?: number;
  target_role?: string;
}) =>
  request<{ success: boolean }>('/notifications', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Platform Settings (admin only) — per individual platform
export const getPlatformSettings = () =>
  request<{ success: boolean; platforms: Record<string, boolean> }>('/platform-settings');

export const patchPlatformSettings = (platforms: Record<string, boolean>) =>
  request<{ success: boolean; platforms: Record<string, boolean> }>(
    '/platform-settings',
    { method: 'PATCH', body: JSON.stringify({ platforms }) }
  );
