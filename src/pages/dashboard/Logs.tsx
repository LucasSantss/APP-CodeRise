import { useLongPoll } from '@/hooks/use-polling';
import { useAuthStore } from '@/store/auth';
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, RefreshCw, Eye, ShoppingCart, MessageSquare, ScrollText } from 'lucide-react';
import { getWebhooks } from '@/services/api';
import type { WebhookEvent } from '@/types';

const statusVariant = (status: string): "outline" | "destructive" | "secondary" | "default" => {
  if (status === 'processed') return 'outline';
  if (status === 'error') return 'destructive';
  return 'secondary';
};

const DATE_FILTERS = [
  { value: 'all',   label: 'Todos os períodos' },
  { value: 'today', label: 'Hoje' },
  { value: '7d',    label: 'Últimos 7 dias' },
  { value: '30d',   label: 'Últimos 30 dias' },
];

const filterByDate = (events: WebhookEvent[], period: string) => {
  if (period === 'all') return events;
  const now = new Date();
  const cutoff = new Date();
  if (period === 'today') {
    cutoff.setHours(0, 0, 0, 0);
  } else if (period === '7d') {
    cutoff.setDate(now.getDate() - 7);
  } else if (period === '30d') {
    cutoff.setDate(now.getDate() - 30);
  }
  return events.filter((e) => new Date(e.received_at) >= cutoff);
};

const SourceBadge = ({ source }: { source?: string }) => {
  if (source === 'chatbot') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <MessageSquare className="h-3 w-3" /> Chatbot
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <ShoppingCart className="h-3 w-3" /> E-commerce
    </span>
  );
};

const UserLogs = () => {
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter]     = useState('all');
  const [dateFilter, setDateFilter]     = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selected, setSelected] = useState<WebhookEvent | null>(null);
  const [lastWebhookId, setLastWebhookId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.event_type = typeFilter;
      if (sourceFilter !== 'all') params.source = sourceFilter;
      const res = await getWebhooks(params);
      const lista: WebhookEvent[] = (res as any).webhooks || [];
      setWebhooks(lista);
      // Sincroniza lastWebhookId com o maior ID já carregado
      if (lista.length > 0) {
        const maxId = Math.max(...lista.map(w => w.id));
        setLastWebhookId(prev => (prev === null || maxId > prev) ? maxId : prev);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, sourceFilter]);

  useEffect(() => { load(); }, [load]);

  const { user } = useAuthStore();
  useLongPoll<WebhookEvent>(
    '/webhooks/poll',
    (items) => {
      // Filtra localmente pelo source se o filtro estiver ativo
      const filtered = sourceFilter !== 'all'
        ? items.filter(e => (e as any).source === sourceFilter)
        : items;
      if (filtered.length === 0) return;
      setLastWebhookId(filtered[0].id);
      setWebhooks(prev => {
        const ids  = new Set(prev.map(e => e.id));
        const novos = filtered.filter(e => !ids.has(e.id));
        return novos.length > 0 ? [...novos, ...prev] : prev;
      });
    },
    lastWebhookId,
    { enabled: !!user }
  );

  const filtered = filterByDate(webhooks, dateFilter);

  return (
    <div className="space-y-6 table-scroll-body" >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Logs</h1>
          <p className="text-muted-foreground">Histórico de eventos recebidos em tempo real</p>
        </div>
        <Button variant="outline" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between flex-wrap">
            <CardTitle>
              Eventos
              {!loading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({filtered.length} resultado{filtered.length !== 1 ? 's' : ''})
                </span>
              )}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Origem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as origens</SelectItem>
                  <SelectItem value="ecommerce">E-commerce</SelectItem>
                  <SelectItem value="chatbot">Chatbot</SelectItem>
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Tipos</SelectItem>
                  <SelectItem value="product.sync">Produto Criado/Atualizado</SelectItem>
                  <SelectItem value="product.deleted">Produto Deletado</SelectItem>
                  <SelectItem value="order.created">Pedido Criado</SelectItem>
                  <SelectItem value="order.shipped">Pedido Enviado</SelectItem>
                  <SelectItem value="order.cancelled">Pedido Cancelado</SelectItem>
                  <SelectItem value="order.partially_shipped">Pedido Parcial</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Status</SelectItem>
                  <SelectItem value="received">Recebido</SelectItem>
                  <SelectItem value="processed">Processado</SelectItem>
                  <SelectItem value="error">Erro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Container único com scroll vertical + horizontal.
              O TableHeader tem position:sticky top:0 para ficar fixo.
              As barras de scroll ficam na borda inferior/direita do container. */}
          <div
            className="table-scroll-body"
            style={{ height: '48vh' }}
          >
            <Table className="min-w-[50vh]">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="min-w-[120px]">Origem</TableHead>
                  <TableHead className="min-w-[160px]">Tipo</TableHead>
                  <TableHead className="min-w-[100px]">Status</TableHead>
                  <TableHead className="min-w-[200px]">Erro</TableHead>
                  <TableHead className="min-w-[160px]">Data</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-2">
                      <>{[1,2,3,4,5,6].map(i => (
                        <div key={i} className="flex gap-3 py-2 border-b border-border/30 last:border-0">
                          <div className="h-4 w-32 shimmer-load rounded-md" />
                          <div className="h-4 w-24 shimmer-load rounded-md" />
                          <div className="h-5 w-20 shimmer-load rounded-full" />
                          <div className="h-5 w-16 shimmer-load rounded-full" />
                          <div className="h-4 w-8 shimmer-load rounded-md" />
                        </div>
                      ))}</>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2 py-4">
                        <ScrollText className="h-8 w-8 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">Nenhum evento no período</p>
                        <p className="text-xs text-muted-foreground/50">Os eventos aparecerão aqui quando chegarem via webhook</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.map((w) => (
                  <TableRow
                    key={w.id}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => setSelected(w)}
                  >
                    <TableCell className="text-xs text-muted-foreground font-mono w-12">#{w.id}</TableCell>
                    <TableCell className="min-w-[120px]">
                      <SourceBadge source={(w as any).source} />
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      <Badge variant="outline" className="text-xs">{w.event_type || 'desconhecido'}</Badge>
                    </TableCell>
                    <TableCell className="min-w-[100px]">
                      <Badge
                        variant={(statusVariant(w.status)) as BadgeVariant}
                        className={w.status === 'processed' ? 'border-success text-success' : ''}
                      >
                        {w.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground min-w-[200px] truncate max-w-xs">
                      {w.error_message || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap min-w-[160px]">
                      {new Date(w.received_at).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="w-12">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); setSelected(w); }}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {!loading && filtered.length > 10 && (
            <p className="text-xs text-muted-foreground text-center py-2 border-t border-border/40">
              {filtered.length} eventos — role para ver todos
            </p>
          )}
        </CardContent>
      </Card>

      {/* Modal de payload */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-[100vh] h-[85vh] overflow-y-auto table-scroll-body">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Payload do Evento
              {selected && (
                <Badge variant="outline" className="text-xs ml-1">{selected.event_type || 'desconhecido'}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">#{selected.id}</span></div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{' '}
                  <Badge
                    variant={(statusVariant(selected.status)) as BadgeVariant}
                    className={selected.status === 'processed' ? 'border-success text-success' : ''}
                  >
                    {selected.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Origem:</span>{' '}
                  <SourceBadge source={(selected as any).source} />
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Recebido em:</span>{' '}
                  <span>{new Date(selected.received_at).toLocaleString('pt-BR')}</span>
                </div>
                {selected.error_message && (
                  <div className="col-span-2 text-destructive text-xs bg-destructive/10 rounded p-2">
                    {selected.error_message}
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-medium mb-2 text-muted-foreground">Payload JSON</p>
                <pre className="bg-muted rounded-lg p-4 text-xs font-mono overflow-visible whitespace-pre-wrap break-all">
                  {selected.payload
                    ? JSON.stringify(selected.payload, null, 2)
                    : '— sem payload —'}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserLogs;