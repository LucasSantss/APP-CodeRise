import { useEffect, useState, useCallback } from 'react';
import { X, Megaphone, AlertTriangle, UserX, Zap, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { useNotificationsStore, filterNotifications, type Notification } from '@/store/notifications';
import { markNotificationRead } from '@/services/api';
import { cn } from '@/lib/utils';

// IDs já exibidos no popup nesta sessão (evita re-exibir ao re-renderizar)
const shownInSession = new Set<number>();

function NotifIcon({ type }: { type: Notification['type'] }) {
  const cls = 'h-7 w-7';
  switch (type) {
    case 'error':             return <AlertTriangle className={cn(cls, 'text-destructive')} />;
    case 'integration_error': return <Zap          className={cn(cls, 'text-orange-400')} />;
    case 'status_change':     return <UserX        className={cn(cls, 'text-yellow-400')} />;
    case 'broadcast':         return <Megaphone    className={cn(cls, 'text-blue-400')} />;
    default:                  return <Bell         className={cn(cls, 'text-muted-foreground')} />;
  }
}

function typeBadgeLabel(type: Notification['type']) {
  switch (type) {
    case 'broadcast':         return 'Aviso da plataforma';
    case 'error':             return 'Erro de integração';
    case 'integration_error': return 'Erro de integração';
    case 'status_change':     return 'Alteração de conta';
    default:                  return 'Notificação';
  }
}

const NotificationPopup = () => {
  const { user } = useAuthStore();
  const role = (user?.role ?? 'user') as 'admin' | 'user';

  const notifications      = useNotificationsStore((s) => s.notifications);
  const markRead           = useNotificationsStore((s) => s.markRead);
  const popupTriggerId     = useNotificationsStore((s) => s.popupTriggerId);
  const clearPopupTrigger  = useNotificationsStore((s) => s.clearPopupTrigger);

  const [current, setCurrent] = useState<Notification | null>(null);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // ── 1. Abrir popup ao clicar numa notificação no sininho ──────────────────
  useEffect(() => {
    if (!popupTriggerId) return;

    const notif = notifications.find((n) => n.id === popupTriggerId);
    if (!notif) {
      clearPopupTrigger();
      return;
    }

    // Garante que o popup anterior fecha antes de abrir o novo
    if (visible) {
      setLeaving(true);
      setTimeout(() => {
        setVisible(false);
        setLeaving(false);
        setCurrent(notif);
        shownInSession.add(notif.id);
        setVisible(true);
        clearPopupTrigger();
      }, 300);
    } else {
      setCurrent(notif);
      shownInSession.add(notif.id);
      setLeaving(false);
      setVisible(true);
      clearPopupTrigger();
    }
  }, [popupTriggerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Popup automático — somente para usuários comuns (não admin) ─────────
  useEffect(() => {
    // Admin NÃO recebe popup automático — as notificações ficam só no sininho
    if (role === 'admin') return;
    if (visible) return; // já tem um popup aberto — não empilha

    const candidates = filterNotifications(notifications, role)
      .filter((n) => !n.read && !shownInSession.has(n.id));

    if (candidates.length === 0) return;

    const next = candidates.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    shownInSession.add(next.id);
    setCurrent(next);
    setLeaving(false);
    setVisible(true);
  }, [notifications, role, visible]);

  const handleClose = useCallback(async () => {
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      setLeaving(false);
      setCurrent(null);
    }, 300);

    if (current) {
      markRead(current.id);
      await markNotificationRead(current.id).catch(() => {});
    }
  }, [current, markRead]);

  // Fecha ao pressionar Escape
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, handleClose]);

  if (!visible || !current) return null;

  const isBroadcast = current.type === 'broadcast';

  return (
    // Overlay
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex items-center justify-center p-4',
        'transition-all duration-300',
        leaving ? 'opacity-0' : 'opacity-100',
      )}
      style={{ backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Card */}
      <div
        className={cn(
          'relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl',
          'transition-all duration-300',
          leaving
            ? 'opacity-0 scale-95 translate-y-4'
            : 'opacity-100 scale-100 translate-y-0',
          'bg-card border border-border/60',
        )}
      >
        {/* Topo colorido por tipo */}
        <div className={cn(
          'h-1.5 w-full',
          isBroadcast       ? 'gradient-brand' :
          current.type === 'error' || current.type === 'integration_error'
                            ? 'bg-destructive' :
          current.type === 'status_change'
                            ? 'bg-yellow-500' : 'gradient-brand'
        )} />

        {/* Botão fechar */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 pt-5 space-y-4">
          {/* Ícone + badge */}
          <div className="flex items-center gap-3">
            <div className={cn(
              'h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0',
              isBroadcast       ? 'gradient-brand shadow-glow-b' :
              current.type === 'error' || current.type === 'integration_error'
                                ? 'bg-destructive/15' :
              current.type === 'status_change'
                                ? 'bg-yellow-500/15' : 'gradient-brand'
            )}>
              <NotifIcon type={current.type} />
            </div>
            <div>
              <span className={cn(
                'inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide',
                isBroadcast       ? 'bg-primary/10 text-primary' :
                current.type === 'error' || current.type === 'integration_error'
                                  ? 'bg-destructive/10 text-destructive' :
                current.type === 'status_change'
                                  ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' :
                'bg-primary/10 text-primary'
              )}>
                {typeBadgeLabel(current.type)}
              </span>
            </div>
          </div>

          {/* Título */}
          <h2 className="text-lg font-bold leading-snug pr-6">{current.title}</h2>

          {/* Mensagem */}
          <div className="text-sm text-muted-foreground leading-relaxed space-y-1">
            {current.message.split("\n").map((line, i) => {
              if (!line.trim()) return null;
              const isLabel = /^(Perfil|Plataforma|Evento|Horário|URL|Detalhe):/.test(line);
              if (isLabel) {
                const colonIdx = line.indexOf(":");
                const label = line.slice(0, colonIdx);
                const value = line.slice(colonIdx + 1).trim();
                return (
                  <p key={i}>
                    <span className="font-medium text-foreground/70">{label}: </span>
                    <span>{value}</span>
                  </p>
                );
              }
              return <p key={i}>{line}</p>;
            })}
          </div>

          {/* Imagem (se houver) */}
          {current.image_url && (
            <div className="rounded-2xl overflow-hidden border border-border/50">
              <img
                src={current.image_url}
                alt="Imagem da notificação"
                className="w-full object-cover max-h-52"
              />
            </div>
          )}

          {/* Botão de fechar */}
          <Button
            className="w-full rounded-xl gradient-brand text-white hover:opacity-90 transition-opacity mt-1"
            onClick={handleClose}
          >
            Entendi
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotificationPopup;
