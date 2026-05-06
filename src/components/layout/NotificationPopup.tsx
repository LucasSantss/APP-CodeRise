import { useEffect, useCallback, useRef } from 'react';
import { X, Megaphone, AlertTriangle, UserX, Zap, Bell, ChevronRight, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { useNotificationsStore, filterNotifications, type Notification } from '@/store/notifications';
import { markNotificationRead } from '@/services/api';
import { cn } from '@/lib/utils';
import { parseApiError } from '@/lib/parseApiError';

// IDs já enfileirados nesta sessão (evita re-enfileirar ao re-renderizar)
const enqueuedInSession = new Set<number>();

function NotifIcon({ type }: { type: Notification['type'] }) {
  const cls = 'h-6 w-6';
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

function stripTechnicalNoise(msg: string): string {
  // Se parecer mensagem técnica de erro de API, traduz
  if (
    msg.includes('HTTP ') ||
    msg.includes('ChatbotMaker') ||
    msg.includes('Error converting') ||
    msg.includes('Suri PUT') ||
    msg.includes('Suri POST')
  ) {
    const parsed = parseApiError(msg);
    return parsed.hint
      ? `${parsed.description}\n💡 ${parsed.hint}`
      : parsed.description;
  }
  return msg;
}

const NotificationPopup = () => {
  const { user } = useAuthStore();
  const role = (user?.role ?? 'user') as 'admin' | 'user';

  const notifications     = useNotificationsStore((s) => s.notifications);
  const markRead          = useNotificationsStore((s) => s.markRead);
  const popupTriggerId    = useNotificationsStore((s) => s.popupTriggerId);
  const clearPopupTrigger = useNotificationsStore((s) => s.clearPopupTrigger);
  const popupQueue        = useNotificationsStore((s) => s.popupQueue);
  const enqueuePopup      = useNotificationsStore((s) => s.enqueuePopup);
  const dequeuePopup      = useNotificationsStore((s) => s.dequeuePopup);
  const clearQueue        = useNotificationsStore((s) => s.clearQueue);
  const popupsEnabled     = useNotificationsStore((s) => s.popupsEnabled);
  const setPopupsEnabled  = useNotificationsStore((s) => s.setPopupsEnabled);

  const current = popupQueue[0] ?? null;
  const remaining = popupQueue.length - 1; // notificações na fila além da atual
  const visible = !!current;

  // ── Abrir popup ao clicar numa notificação no sininho ──────────────────────
  useEffect(() => {
    if (!popupTriggerId) return;
    const notif = notifications.find((n) => n.id === popupTriggerId);
    if (!notif) { clearPopupTrigger(); return; }
    enqueuedInSession.add(notif.id);
    enqueuePopup(notif);
    clearPopupTrigger();
  }, [popupTriggerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enfileirar notificações novas automaticamente (apenas usuários comuns) ─
  useEffect(() => {
    if (role === 'admin') return;
    if (!popupsEnabled) return;

    const candidates = filterNotifications(notifications, role)
      .filter((n) => !n.read && !enqueuedInSession.has(n.id));

    for (const notif of candidates) {
      enqueuedInSession.add(notif.id);
      enqueuePopup(notif);
    }
  }, [notifications, role, popupsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(async () => {
    if (!current) return;
    markRead(current.id);
    dequeuePopup();
    await markNotificationRead(current.id).catch(() => {});
  }, [current, markRead, dequeuePopup]);

  const handleCloseAll = useCallback(async () => {
    for (const n of popupQueue) {
      markRead(n.id);
      markNotificationRead(n.id).catch(() => {});
    }
    clearQueue();
  }, [popupQueue, markRead, clearQueue]);

  // Fecha ao pressionar Escape
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, handleClose]);

  if (!visible || !current) return null;

  const isBroadcast = current.type === 'broadcast';
  const isError = current.type === 'error' || current.type === 'integration_error';
  const isStatus = current.type === 'status_change';

  const accentClass = isBroadcast ? 'gradient-brand'
    : isError   ? 'bg-destructive'
    : isStatus  ? 'bg-yellow-500'
    : 'gradient-brand';

  const iconBgClass = isBroadcast ? 'gradient-brand shadow-glow-b'
    : isError   ? 'bg-destructive/15'
    : isStatus  ? 'bg-yellow-500/15'
    : 'gradient-brand';

  const badgeClass = isBroadcast ? 'bg-primary/10 text-primary'
    : isError   ? 'bg-destructive/10 text-destructive'
    : isStatus  ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
    : 'bg-primary/10 text-primary';

  const cleanMessage = stripTechnicalNoise(current.message);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 sm:p-6"
      style={{ backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* ── Card principal ── */}
      <div className="relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl bg-card border border-border/60 animate-in slide-in-from-bottom-4 duration-300">

        {/* Barra de cor no topo */}
        <div className={cn('h-1.5 w-full', accentClass)} />

        {/* Header do card */}
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <div className="flex items-center gap-2">
            <div className={cn('h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0', iconBgClass)}>
              <NotifIcon type={current.type} />
            </div>
            <span className={cn('inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide', badgeClass)}>
              {typeBadgeLabel(current.type)}
            </span>
          </div>

          {/* Ações do header */}
          <div className="flex items-center gap-1">
            {/* Toggle desabilitar popups */}
            <button
              title={popupsEnabled ? 'Desativar notificações automáticas' : 'Ativar notificações automáticas'}
              onClick={() => setPopupsEnabled(!popupsEnabled)}
              className="h-7 w-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              {popupsEnabled
                ? <Bell className="h-3.5 w-3.5" />
                : <BellOff className="h-3.5 w-3.5 text-muted-foreground/50" />
              }
            </button>

            {/* Fechar atual */}
            <button
              onClick={handleClose}
              className="h-7 w-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="px-5 pt-3 pb-5 space-y-3">
          <h2 className="text-base font-bold leading-snug">{current.title}</h2>

          <div className="text-sm text-muted-foreground leading-relaxed space-y-1 max-h-40 overflow-y-auto pr-1">
            {cleanMessage.split('\n').map((line, i) => {
              if (!line.trim()) return null;
              const isHint = line.startsWith('💡');
              if (isHint) {
                return (
                  <p key={i} className="text-xs mt-2 px-2 py-1.5 rounded-lg bg-muted/60 text-muted-foreground/80 border border-border/40">
                    {line}
                  </p>
                );
              }
              const isLabel = /^(Perfil|Plataforma|Evento|Horário|URL|Detalhe):/.test(line);
              if (isLabel) {
                const colonIdx = line.indexOf(':');
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

          {current.image_url && (
            <div className="rounded-2xl overflow-hidden border border-border/50">
              <img src={current.image_url} alt="Imagem da notificação" className="w-full object-cover max-h-44" />
            </div>
          )}

          {/* ── Fila acumulada ── */}
          {remaining > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {remaining}
                </span>
                <span className="text-xs text-muted-foreground">
                  {remaining === 1 ? 'mais notificação na fila' : 'mais notificações na fila'}
                </span>
              </div>
              <button
                onClick={handleCloseAll}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                Dispensar todas <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Botões de ação */}
          <div className="flex gap-2 pt-1">
            {remaining > 0 ? (
              <>
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl text-sm"
                  onClick={handleCloseAll}
                >
                  Dispensar todas
                </Button>
                <Button
                  className="flex-1 rounded-xl gradient-brand text-white hover:opacity-90 transition-opacity text-sm"
                  onClick={handleClose}
                >
                  Próxima →
                </Button>
              </>
            ) : (
              <Button
                className="w-full rounded-xl gradient-brand text-white hover:opacity-90 transition-opacity"
                onClick={handleClose}
              >
                Entendi
              </Button>
            )}
          </div>

          {/* Indicador de desabilitado */}
          {!popupsEnabled && (
            <p className="text-center text-[10px] text-muted-foreground/50 flex items-center justify-center gap-1">
              <BellOff className="h-3 w-3" /> Popups automáticos desativados
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationPopup;
