import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Link2, Webhook, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { getUsers, getIntegrations, getWebhooks } from '@/services/api';
import type { User, UserIntegration, WebhookEvent } from '@/types';
import BroadcastNotificationPanel from '@/components/admin/BroadcastNotificationPanel';

const POLL_INTERVAL = 30_000; // 30s

const AdminDashboard = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [integrations, setIntegrations] = useState<UserIntegration[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [u, i, w] = await Promise.all([getUsers(), getIntegrations(), getWebhooks()]);
      setUsers((u as any).users || []);
      setIntegrations((i as any).integrations || []);
      setWebhooks((w as any).webhooks || []);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(() => load(true), POLL_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  const today = new Date().toDateString();
  const eventsToday = webhooks.filter((w) => new Date(w.received_at).toDateString() === today).length;
  const errors = webhooks.filter((w) => w.status === 'error').length;
  const activeIntegrations = integrations.filter((i) => i.suri_active || i.ecommerce_active).length;

  const stats = [
    { title: 'Total Usuários',     value: String(users.length),          icon: Users,          color: 'text-primary' },
    { title: 'Integrações Ativas', value: String(activeIntegrations),    icon: Link2,          color: 'text-success' },
    { title: 'Eventos Hoje',       value: String(eventsToday),           icon: Webhook,        color: 'text-warning' },
    { title: 'Erros Recentes',     value: String(errors),                icon: AlertTriangle,  color: 'text-destructive' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard Admin</h1>
          <p className="text-muted-foreground">Visão geral da plataforma</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <Button variant="outline" size="icon" onClick={() => load(true)} disabled={refreshing || loading}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                <div className="text-3xl font-bold">{stat.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BroadcastNotificationPanel />
        <Card>
          <CardHeader><CardTitle>Erros de Integração</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : webhooks.filter(w => w.status === 'error').length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhum erro de integração registrado.</p>
            ) : (
              <div className="space-y-2">
                {webhooks.filter(w => w.status === 'error').slice(0, 6).map((w) => (
                  <div key={w.id} className="flex items-start gap-2 text-sm py-1.5 border-b last:border-0">
                    <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{w.event_type || 'desconhecido'}</p>
                      {w.error_message && <p className="text-xs text-muted-foreground truncate">{w.error_message}</p>}
                    </div>
                    <span className="text-muted-foreground text-xs flex-shrink-0">{new Date(w.received_at).toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboard;
