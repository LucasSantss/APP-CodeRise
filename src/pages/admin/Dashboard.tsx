import { useEffect, useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Users, Link2, Activity, AlertTriangle,
  CheckCircle2, Clock, RefreshCw, Layers,
} from 'lucide-react';
import { getUsers, getIntegrations, getWebhooks, getQueueStats } from '@/services/api';
import type { User, UserIntegration, WebhookEvent } from '@/types';
import BroadcastNotificationPanel from '@/components/admin/BroadcastNotificationPanel';
import { useGsapStagger, useGsapCounter } from '@/hooks/use-gsap';
import gsap from 'gsap';

const Sk = ({ w = 'w-16', h = 'h-8' }: { w?: string; h?: string }) => (
  <div className={`${w} ${h} shimmer-load rounded-lg`} />
);

interface QueueStat { status: string; count: string; avg_duration_s: string | null }

const AdminDashboard = () => {
  const [users,        setUsers]        = useState<User[]>([]);
  const [integrations, setIntegrations] = useState<UserIntegration[]>([]);
  const [webhooks,     setWebhooks]     = useState<WebhookEvent[]>([]);
  const [queueStats,   setQueueStats]   = useState<QueueStat[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const statsRef  = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.09, y: 28, delay: 0.1 });
  const bottomRef = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1,  y: 20, delay: 0.35 });

  const errors     = webhooks.filter(w => w.status === 'error').length;
  const today      = new Date().toDateString();
  const eventsToday = webhooks.filter(w => new Date(w.received_at).toDateString() === today).length;
  const activeInteg = integrations.filter(i => i.suri_active || i.ecommerce_active).length;

  const totalRef  = useGsapCounter(users.length,   [loading]);
  const activeRef = useGsapCounter(activeInteg,     [loading]);
  const todayRef  = useGsapCounter(eventsToday,     [loading]);
  const errRef    = useGsapCounter(errors,          [loading]);

  useEffect(() => {
    if (!headerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(headerRef.current!, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
    }, headerRef);
    return () => ctx.revert();
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [u, i, w, q] = await Promise.allSettled([
        getUsers(),
        getIntegrations(),
        getWebhooks({ limit: '200' }),
        getQueueStats().catch(() => ({ stats: [] })),
      ]);
      if (u.status === 'fulfilled') setUsers((u.value as any).users || []);
      if (i.status === 'fulfilled') setIntegrations((i.value as any).integrations || []);
      if (w.status === 'fulfilled') setWebhooks((w.value as any).webhooks || []);
      if (q.status === 'fulfilled') setQueueStats((q.value as any).stats || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const qPending    = queueStats.find(s => s.status === 'pending')?.count    || '0';
  const qProcessing = queueStats.find(s => s.status === 'processing')?.count || '0';
  const qDone       = queueStats.find(s => s.status === 'done')?.count       || '0';
  const qFailed     = queueStats.find(s => s.status === 'failed')?.count     || '0';
  const avgDur      = queueStats.find(s => s.status === 'done')?.avg_duration_s;

  const metricCards = [
    { title: 'Total Usuários',     ref: totalRef,  icon: Users,          color: 'text-[#a78bfa]', grad: 'from-[#26316a]/10 to-[#56388e]/10', iconBg: 'bg-[#56388e]/15' },
    { title: 'Integrações Ativas', ref: activeRef, icon: Link2,          color: 'text-emerald-400', grad: 'from-emerald-950/10 to-teal-950/10', iconBg: 'bg-emerald-900/20' },
    { title: 'Eventos Hoje',       ref: todayRef,  icon: Activity,       color: 'text-[#60a5fa]', grad: 'from-[#2f7bb9]/10 to-[#26316a]/10', iconBg: 'bg-[#2f7bb9]/15' },
    { title: 'Erros Recentes',     ref: errRef,    icon: AlertTriangle,  color: errors > 0 ? 'text-rose-400' : 'text-muted-foreground', grad: errors > 0 ? 'from-rose-950/10 to-[#26316a]/10' : 'from-card to-card', iconBg: errors > 0 ? 'bg-rose-900/20' : 'bg-muted/50' },
  ];

  return (
    <div className="space-y-6 w-auto">
      {/* Cabeçalho */}
      <div ref={headerRef} style={{ opacity: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Dashboard <span className="text-gradient-brand">Admin</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Visão geral da plataforma em tempo real</p>
        </div>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-white rounded-xl h-8"
          onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Métricas */}
      <div ref={statsRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((s) => (
          <Card key={s.title} style={{ opacity: 0 }}
            className={`rounded-2xl border-border/60 bg-gradient-to-br ${s.grad} overflow-hidden`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{s.title}</CardTitle>
              <div className={`h-8 w-8 rounded-xl ${s.iconBg} flex items-center justify-center`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {loading ? <Sk h="h-9" w="w-14" /> :
                <div className="text-3xl font-bold tracking-tight">
                  <span ref={s.ref as React.RefObject<HTMLSpanElement>}>0</span>
                </div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monitor fila + Erros + Broadcast */}
      <div ref={bottomRef} className="grid gap-4 lg:grid-cols-2">

        {/* Monitor de fila */}
        <Card style={{ opacity: 0 }} className="rounded-2xl border-border/60">
          <CardHeader className="pb-3 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-[#a78bfa]" />
                <CardTitle className="text-sm font-semibold">Fila de processamento</CardTitle>
              </div>
              <span className="text-xs text-muted-foreground">últimas 24h</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {loading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="flex justify-between">
                    <Sk w="w-24" h="h-4" /><Sk w="w-8" h="h-4" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                {[
                  { label: 'Pendentes',   value: qPending,    Icon: Clock,         c: 'text-amber-400',   bg: 'bg-amber-400/10' },
                  { label: 'Processando', value: qProcessing, Icon: Activity,      c: 'text-blue-400',    bg: 'bg-blue-400/10' },
                  { label: 'Concluídos',  value: qDone,       Icon: CheckCircle2,  c: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                  { label: 'Com falha',   value: qFailed,     Icon: AlertTriangle, c: parseInt(qFailed) > 0 ? 'text-rose-400' : 'text-muted-foreground', bg: parseInt(qFailed) > 0 ? 'bg-rose-400/10' : 'bg-muted/30' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className={`h-6 w-6 rounded-lg ${row.bg} flex items-center justify-center`}>
                        <row.Icon className={`h-3.5 w-3.5 ${row.c}`} />
                      </div>
                      <span className="text-sm text-muted-foreground">{row.label}</span>
                    </div>
                    <span className={`text-sm font-bold ${row.c}`}>{row.value}</span>
                  </div>
                ))}
                {avgDur && (
                  <p className="text-xs text-muted-foreground/60 pt-1">
                    Tempo médio: {parseFloat(avgDur).toFixed(1)}s
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Erros recentes */}
        <Card style={{ opacity: 0 }} className="rounded-2xl border-border/60">
          <CardHeader className="pb-3 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
                <CardTitle className="text-sm font-semibold">Erros recentes</CardTitle>
              </div>
              <Badge variant="destructive" className="text-xs rounded-lg">{errors}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => (
                  <div key={i} className="flex gap-2">
                    <Sk w="w-4" h="h-4" /><Sk w="w-full" h="h-4" />
                  </div>
                ))}
              </div>
            ) : webhooks.filter(w => w.status === 'error').length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400/50 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum erro registrado</p>
                <p className="text-xs text-muted-foreground/50 mt-1">Todas as integrações operando normalmente</p>
              </div>
            ) : (
              <div className="space-y-1">
                {webhooks.filter(w => w.status === 'error').slice(0, 5).map(w => (
                  <div key={w.id} className="flex items-start gap-2 text-sm py-2 border-b border-border/40 last:border-0">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate text-xs">{w.event_type || 'desconhecido'}</p>
                      {w.error_message && <p className="text-xs text-muted-foreground truncate">{w.error_message}</p>}
                    </div>
                    <span className="text-muted-foreground text-xs flex-shrink-0">
                      {new Date(w.received_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Broadcast */}
        <div style={{ opacity: 0 }} className="lg:col-span-2">
          <BroadcastNotificationPanel />
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
