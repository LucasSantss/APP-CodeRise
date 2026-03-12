import { useLongPoll } from '@/hooks/use-polling';
import { useEffect, useCallback } from 'react';
import { Bell, X, AlertTriangle, UserX, Zap, Megaphone, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuthStore } from '@/store/auth';
import { useNotificationsStore, filterNotifications, type Notification } from '@/store/notifications';
import { getNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification } from '@/services/api';
import { cn } from '@/lib/utils';
import { useState } from 'react';

function NotifIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'error':             return <AlertTriangle className="h-4 w-4 text-destructive" />;
    case 'integration_error': return <Zap className="h-4 w-4 text-orange-500" />;
    case 'status_change':     return <UserX className="h-4 w-4 text-yellow-500" />;
    case 'broadcast':         return <Megaphone className="h-4 w-4 text-blue-500" />;
    default:                  return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

const NotificationPanel = () => {
  const { user, token } = useAuthStore();
  const role = (user?.role ?? 'user') as 'admin' | 'user';

  const notifications    = useNotificationsStore((s) => s.notifications);
  const loading          = useNotificationsStore((s) => s.loading);
  const setNotifications = useNotificationsStore((s) => s.setNotifications);
  const setLoading       = useNotificationsStore((s) => s.setLoading);
  const markRead         = useNotificationsStore((s) => s.markRead);
  const markAllRead      = useNotificationsStore((s) => s.markAllRead);
  const remove           = useNotificationsStore((s) => s.remove);
  const openPopupFor     = useNotificationsStore((s) => s.openPopupFor);

  const [open, setOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await getNotifications();
      setNotifications(res.notifications || []);
      setLoading(false);
    } catch {}
  }, [setNotifications, setLoading]);

  useEffect(() => {
    if (!user || !token) return;
    setLoading(true);
    fetchNotifications();
  }, [user, token, fetchNotifications, setLoading]);

  const lastNotifId = notifications.length > 0 ? Math.max(...notifications.map(n => n.id)) : null;
  useLongPoll<Notification>(
    '/notifications',
    () => { fetchNotifications(); },
    lastNotifId,
    { enabled: !!user && !!token }
  );

  const visible = filterNotifications(notifications, role);
  const unread  = visible.filter((n) => !n.read).length;

  const handleMarkAll = async () => {
    markAllRead();
    await markAllNotificationsRead().catch(() => {});
  };

  const handleRemove = async (id: number) => {
    remove(id);
    await deleteNotification(id).catch(() => {});
  };

  // Ao clicar numa notificação no sininho: fecha o painel e abre o popup
  const handleOpenPopup = (id: number) => {
    setOpen(false);
    openPopupFor(id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-muted transition-all relative">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 rounded-2xl border-border/60 shadow-brand-md overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/30">
          <div>
            <p className="text-sm font-semibold">Notificações</p>
            {unread > 0 && (
              <p className="text-[11px] text-muted-foreground">{unread} não lida{unread > 1 ? 's' : ''}</p>
            )}
          </div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground" onClick={handleMarkAll}>
              <CheckCheck className="h-3 w-3" /> Marcar todas
            </Button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <Bell className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma notificação</p>
            </div>
          ) : (
            visible.map((n) => (
              <div
                key={n.id}
                className={cn(
                  'flex gap-3 px-4 py-3 border-b last:border-0 border-border/40 cursor-pointer transition-colors hover:bg-muted/40',
                  !n.read && 'bg-primary/5'
                )}
                onClick={() => handleOpenPopup(n.id)}
              >
                <div className="flex-shrink-0 h-8 w-8 rounded-xl bg-muted flex items-center justify-center mt-0.5">
                  <NotifIcon type={n.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold leading-snug">{n.title}</p>
                    <button
                      className="flex-shrink-0 text-muted-foreground/50 hover:text-muted-foreground mt-0.5"
                      onClick={(e) => { e.stopPropagation(); handleRemove(n.id); }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2 whitespace-pre-line">{n.message}</p>
                  {n.image_url && (
                    <img src={n.image_url} alt="Notificação" className="mt-2 w-full rounded-lg object-cover max-h-28" />
                  )}
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
                </div>
                {!n.read && <span className="flex-shrink-0 h-2 w-2 rounded-full bg-primary mt-1.5" />}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationPanel;
