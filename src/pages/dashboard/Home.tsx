import { useEffect, useState, useCallback, useRef } from 'react';
import { useLongPoll } from '@/hooks/use-polling';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  MessageSquare, ShoppingCart, Webhook, Loader2,
  CheckCircle2, Activity, TrendingUp, AlertCircle,
  ArrowRight, Zap, Circle, XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getIntegrations, getWebhooks, getChatbot } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import type { UserIntegration, WebhookEvent } from '@/types';
import gsap from 'gsap';
import { useGsapStagger, useGsapCounter } from '@/hooks/use-gsap';

const STATUS_COLORS: Record<string, string> = {
  processed: 'text-emerald-500',
  error:      'text-rose-500',
  received:   'text-amber-500',
};

type ConnStatus = 'success' | 'error' | 'idle';

const UserHome = () => {
  const navigate              = useNavigate();
  const { user }              = useAuthStore();
  const [integration, setIntegration] = useState<UserIntegration | null>(null);
  const [chatbotConnStatus, setChatbotConnStatus] = useState<ConnStatus>('idle');
  const [ecommerceConnStatus, setEcommerceConnStatus] = useState<ConnStatus>('idle');
  const [chatbotPlatformLabel, setChatbotPlatformLabel] = useState('');
  const [events, setEvents]   = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [iRes, wRes, cRes] = await Promise.all([
        getIntegrations(),
        getWebhooks({}),
        getChatbot(),
      ]);

      const i: UserIntegration | null = (iRes as any).integration || null;
      setIntegration(i);

      // E-commerce connection status from saved config
      const ecomConfig = i?.ecommerce_config as Record<string, string> | null;
      setEcommerceConnStatus((ecomConfig?._connection_status as ConnStatus) || 'idle');

      // Chatbot connection status from chatbot config
      const c = (cRes as any).chatbot;
      const chatConfig = c?.chatbot_config as Record<string, string> | null;
      setChatbotConnStatus((chatConfig?._connection_status as ConnStatus) || 'idle');
      setChatbotPlatformLabel(c?.chatbot_platform || '');

      const lista = (wRes as any).webhooks ?? [];
      setEvents(Array.isArray(lista) ? lista : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [lastWebhookId, setLastWebhookId] = useState<number | null>(null);
  useLongPoll<WebhookEvent>(
    '/webhooks/poll',
    (items) => { setLastWebhookId(items[0].id); load(); },
    lastWebhookId,
    { enabled: !!user }
  );

  const today        = new Date().toDateString();
  const totalEvents  = events.length;
  const eventsToday  = events.filter((e) => new Date(e.received_at).toDateString() === today).length;
  const errorEvents  = events.filter((e) => e.status === 'error').length;
  const lastEvent    = events[0] || null;
  const firstName    = user?.name?.split(' ')[0] || 'usuário';

  // ── Status card helpers ──────────────────────────────────────────────────
  // Connection test result always takes priority over the active toggle.
  // "active" only adds meaning when there's a confirmed successful connection.
  const getConnBadge = (
    active: boolean,
    connStatus: ConnStatus,
    activeLabel: string,
    errorLabel: string,
    idleLabel: string,
  ) => {
    // Falha sempre prevalece — independente do toggle ativo
    if (connStatus === 'error')   return { variant: 'destructive' as const, className: 'text-xs', label: errorLabel, icon: <XCircle className="h-3 w-3 mr-1" /> };
    // Conexão OK + toggle ativo = integração funcionando
    if (connStatus === 'success' && active) return { variant: 'outline' as const, className: 'border-emerald-400/40 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400', label: activeLabel, icon: <Circle className="h-1.5 w-1.5 fill-current mr-1" /> };
    // Conexão OK mas toggle inativo = configurado mas não ativado
    if (connStatus === 'success') return { variant: 'outline' as const, className: 'border-amber-400/40 text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400', label: 'Configurado', icon: <CheckCircle2 className="h-3 w-3 mr-1" /> };
    // Sem teste ainda
    return { variant: 'secondary' as const, className: '', label: idleLabel, icon: null };
  };

  const chatbotBadge = getConnBadge(
    integration?.suri_active ?? false,
    chatbotConnStatus,
    chatbotPlatformLabel ? `${chatbotPlatformLabel} ativo` : 'Ativo',
    'Falha na conexão',
    chatbotPlatformLabel ? chatbotPlatformLabel : 'Não configurado',
  );

  const ecommerceBadge = getConnBadge(
    integration?.ecommerce_active ?? false,
    ecommerceConnStatus,
    integration?.ecommerce_platform ? `${integration.ecommerce_platform} ativo` : 'Ativo',
    'Falha na conexão',
    integration?.ecommerce_platform || 'Não configurado',
  );

  const statusCards = [
    {
      title: 'Chatbot',
      icon: MessageSquare,
      badge: chatbotBadge,
      link: '/dashboard/chatbot',
      gradient: 'from-[#26316a]/10 to-[#56388e]/10',
      iconBg: 'bg-[#56388e]/15',
      iconColor: 'text-[#56388e]',
    },
    {
      title: 'E-commerce',
      icon: ShoppingCart,
      badge: ecommerceBadge,
      link: '/dashboard/ecommerce-config',
      gradient: 'from-[#2f7bb9]/10 to-[#26316a]/10',
      iconBg: 'bg-[#2f7bb9]/15',
      iconColor: 'text-[#2f7bb9]',
    },
    {
      title: 'Webhooks',
      icon: Webhook,
      badge: (() => {
        const hasWebhook = !!(integration?.webhook_token && (integration as any)?.chatbot_token);
        return hasWebhook
          ? { variant: 'outline' as const, className: 'border-emerald-400/40 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400', label: 'Ambos ativos', icon: <Circle className="h-1.5 w-1.5 fill-current mr-1" /> }
          : integration?.webhook_token
            ? { variant: 'outline' as const, className: 'border-amber-400/40 text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400', label: 'E-commerce ativo', icon: null }
            : { variant: 'secondary' as const, className: '', label: 'Pendente', icon: null };
      })(),
      link: '/dashboard/webhooks',
      gradient: 'from-[#56388e]/10 to-[#2f7bb9]/10',
      iconBg: 'bg-gradient-to-br from-[#56388e]/15 to-[#2f7bb9]/15',
      iconColor: 'text-[#2f7bb9]',
    },
  ];

  const metrics = [
    { title: 'Total de Eventos', value: totalEvents, icon: Activity, color: 'text-brand-blue', sub: 'todos os tempos' },
    { title: 'Eventos Hoje', value: eventsToday, icon: TrendingUp, color: 'text-emerald-500', sub: new Date().toLocaleDateString('pt-BR') },
    { title: 'Erros', value: errorEvents, icon: AlertCircle, color: errorEvents > 0 ? 'text-rose-500' : 'text-muted-foreground', sub: 'aguardando ação' },
  ];

  // ── Primeiros Passos ──────────────────────────────────────────────────────
  // "done" = conexão testada com sucesso OU integração ativa
  const chatbotDone    = chatbotConnStatus === 'success' || (integration?.suri_active ?? false);
  const ecommerceDone  = ecommerceConnStatus === 'success' || (integration?.ecommerce_active ?? false);
  const webhookDone    = totalEvents > 0;

  const steps = [
    { step: 1, text: 'Configure a conexão com o chatbot',     done: chatbotDone,   link: '/dashboard/chatbot' },
    { step: 2, text: 'Configure sua plataforma de e-commerce', done: ecommerceDone, link: '/dashboard/ecommerce-config' },
    { step: 3, text: 'Registre o webhook na sua loja',          done: webhookDone,   link: '/dashboard/webhooks' },
  ];
  const allDone   = steps.every((s) => s.done);
  const doneCount = steps.filter((s) => s.done).length;

  // ── GSAP ──────────────────────────────────────────────────────────────────
  const headerRef     = useRef<HTMLDivElement>(null);
  const statusGridRef = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1, y: 30, delay: 0.1 });
  const metricsRef    = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1, y: 24, delay: 0.28 });
  const bottomRef     = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.12, y: 20, delay: 0.45 });
  const totalRef      = useGsapCounter(totalEvents,  [loading]);
  const todayRef      = useGsapCounter(eventsToday,  [loading]);
  const errorsRef     = useGsapCounter(errorEvents,  [loading]);

  useEffect(() => {
    if (!headerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(headerRef.current!, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
    }, headerRef);
    return () => ctx.revert();
  }, []);

  const handleCardEnter = (e: React.MouseEvent<HTMLDivElement>) =>
    gsap.to(e.currentTarget, { y: -5, scale: 1.015, duration: 0.28, ease: 'power2.out' });
  const handleCardLeave = (e: React.MouseEvent<HTMLDivElement>) =>
    gsap.to(e.currentTarget, { y: 0, scale: 1, duration: 0.32, ease: 'power2.inOut' });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Saudação */}
      <div ref={headerRef} style={{ opacity: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight">
          Olá, <span className="text-gradient-brand">{firstName}</span> 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Aqui está a visão geral da sua integração em tempo real.</p>
      </div>

      {/* Status cards */}
      <div ref={statusGridRef} className="grid gap-4 sm:grid-cols-3">
        {statusCards.map((card) => (
          <Card
            key={card.title}
            style={{ opacity: 0 }}
            className={`cursor-pointer border-border/60 bg-gradient-to-br ${card.gradient} relative overflow-hidden rounded-2xl`}
            onClick={() => navigate(card.link)}
            onMouseEnter={handleCardEnter}
            onMouseLeave={handleCardLeave}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold text-muted-foreground">{card.title}</CardTitle>
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                : <div className={`h-8 w-8 rounded-xl ${card.iconBg} flex items-center justify-center`}><card.icon className={`h-4 w-4 ${card.iconColor}`} /></div>
              }
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {loading ? <div className="h-5 w-28 shimmer-load rounded-lg" /> : (
                <div className="flex items-center justify-between">
                  <Badge variant={card.badge.variant} className={`rounded-lg text-xs flex items-center ${card.badge.className}`}>
                    {card.badge.icon}{card.badge.label}
                  </Badge>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Métricas */}
      <div ref={metricsRef} className="grid gap-4 sm:grid-cols-3">
        {metrics.map((m, idx) => {
          const counterRef = [totalRef, todayRef, errorsRef][idx];
          return (
            <Card key={m.title} style={{ opacity: 0 }} className="rounded-2xl border-border/60">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-5">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{m.title}</CardTitle>
                <m.icon className={`h-4 w-4 ${m.color}`} />
              </CardHeader>
              <CardContent className="px-5 pb-4">
                {loading ? <div className="h-9 w-16 shimmer-load rounded-lg" /> : (
                  <>
                    <div className="text-3xl font-bold tracking-tight">
                      <span ref={counterRef as React.RefObject<HTMLSpanElement>}>0</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div ref={bottomRef} className="grid gap-4 sm:grid-cols-2">
        {lastEvent ? (
          <Card style={{ opacity: 0 }} className="rounded-2xl border-border/60">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Último Evento</CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7 rounded-lg" onClick={() => navigate('/dashboard/logs')}>
                  Ver logs <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="rounded-lg text-xs font-mono flex-shrink-0">{lastEvent.event_type || 'desconhecido'}</Badge>
                  <span className={`text-xs font-medium flex-shrink-0 ${STATUS_COLORS[lastEvent.status] || ''}`}>{lastEvent.status}</span>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">{new Date(lastEvent.received_at).toLocaleString('pt-BR')}</span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card style={{ opacity: 0 }} className="rounded-2xl border-border/60 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <Zap className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum evento recebido ainda</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Configure o webhook para começar</p>
            </CardContent>
          </Card>
        )}

        {!allDone && (
          <Card style={{ opacity: 0 }} className="rounded-2xl border-border/60 gradient-brand-soft">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Primeiros Passos</CardTitle>
                <span className="text-xs text-muted-foreground font-medium">{doneCount}/{steps.length}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                <div className="h-full rounded-full gradient-brand transition-all duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-2.5">
              {steps.map((item) => (
                <div key={item.step} className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate(item.link)}>
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition-all ${item.done ? 'gradient-brand text-white' : 'bg-muted text-muted-foreground group-hover:bg-primary/10'}`}>
                    {item.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : item.step}
                  </div>
                  <span className={`text-sm transition-colors ${item.done ? 'line-through text-muted-foreground/50' : 'group-hover:text-brand-blue'}`}>{item.text}</span>
                  {!item.done && <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-all" />}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {allDone && (
          <Card style={{ opacity: 0 }} className="rounded-2xl border-emerald-200/50 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-800/30">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <div className="h-12 w-12 rounded-2xl gradient-brand flex items-center justify-center mb-3 shadow-brand-md">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Integração completa!</p>
              <p className="text-xs text-muted-foreground mt-1">Sua loja está conectada e pronta.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default UserHome;
