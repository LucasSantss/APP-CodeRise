// Store apenas de estado local — a fonte de verdade é o banco via API.
// Os componentes chamam as funções da API diretamente e atualizam este store.
import { create } from 'zustand';

export type NotificationType = 'error' | 'status_change' | 'integration_error' | 'broadcast';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  image_url?: string;
  read: boolean;
  target_role?: 'user' | 'admin' | 'all';
  target_user_id?: number;
  scheduled_at?: string;
  created_at: string;
}

const NOTIF_ENABLED_KEY = 'coderise_notifications_enabled';

function loadEnabledPref(): boolean {
  try { return localStorage.getItem(NOTIF_ENABLED_KEY) !== 'false'; } catch { return true; }
}
function saveEnabledPref(v: boolean) {
  try { localStorage.setItem(NOTIF_ENABLED_KEY, String(v)); } catch {}
}

interface NotificationsState {
  notifications: Notification[];
  loading: boolean;

  /** Fila de notificações pendentes de exibição no popup */
  popupQueue: Notification[];

  /** ID de notificação para abrir manualmente pelo sininho */
  popupTriggerId: number | null;

  /** Se o usuário habilitou popups automáticos de notificação */
  popupsEnabled: boolean;

  setNotifications: (n: Notification[]) => void;
  setLoading: (v: boolean) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  remove: (id: number) => void;
  addLocal: (n: Notification) => void;

  openPopupFor: (id: number) => void;
  clearPopupTrigger: () => void;
  enqueuePopup: (n: Notification) => void;
  dequeuePopup: () => void;
  clearQueue: () => void;
  setPopupsEnabled: (v: boolean) => void;
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  notifications: [],
  loading: false,
  popupQueue: [],
  popupTriggerId: null,
  popupsEnabled: loadEnabledPref(),

  setNotifications: (notifications) => set({ notifications }),
  setLoading: (loading) => set({ loading }),

  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    })),

  remove: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
      popupQueue: s.popupQueue.filter((n) => n.id !== id),
    })),

  addLocal: (n: Notification) =>
    set((s: NotificationsState) => ({ notifications: [n, ...s.notifications] })),

  openPopupFor: (id) => set({ popupTriggerId: id }),
  clearPopupTrigger: () => set({ popupTriggerId: null }),

  enqueuePopup: (n: Notification) =>
    set((s) => {
      if (s.popupQueue.some((q) => q.id === n.id)) return s;
      return { popupQueue: [...s.popupQueue, n] };
    }),

  dequeuePopup: () =>
    set((s) => ({ popupQueue: s.popupQueue.slice(1) })),

  clearQueue: () => set({ popupQueue: [] }),

  setPopupsEnabled: (v: boolean) => {
    saveEnabledPref(v);
    set({ popupsEnabled: v, ...(v ? {} : { popupQueue: [] }) });
  },
}));

// ── Helpers de filtro (usados nos componentes) ────────────────────────────────
export function filterNotifications(
  notifications: Notification[],
  role: 'admin' | 'user'
): Notification[] {
  return notifications.filter((n) => {
    if (role === 'admin') {
      return (
        n.type === 'integration_error' ||
        (n.type === 'broadcast' && (n.target_role === 'admin' || n.target_role === 'all'))
      );
    }
    return (
      n.type === 'error' ||
      n.type === 'status_change' ||
      (n.type === 'broadcast' && (n.target_role === 'user' || n.target_role === 'all'))
    );
  });
}
