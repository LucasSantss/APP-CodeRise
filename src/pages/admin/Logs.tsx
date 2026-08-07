import { useAuthStore } from '@/store/auth';
import { useEffect, useState, useCallback } from 'react';
import { useLongPoll } from '@/hooks/use-polling';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, RefreshCw, Eye, ShoppingCart, MessageSquare, Inbox, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getWebhooks } from '@/services/api';
import type { WebhookEvent } from '@/types';
import { WebhookErrorDetail } from '@/components/webhook-error-detail';

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
  const cutoff = new Date();
  if (period === 'today') cutoff.setHours(0, 0, 0, 0);
  else if (period === '7d') cutoff.setDate(cutoff.getDate() - 7);
  else if (period === '30d') cutoff.setDate(cutoff.getDate() - 30);
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

const AdminLogs = () => {
  const [webhooks, setWebhooks] = useState<(WebhookEvent & { user_name?: string; user_email?: string; source?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selected, setSelected] = useState<WebhookEvent | null>(null);

  // Status não é filtrado no servidor — assim o resumo de Recebidos/Processados/
  // Erros abaixo reflete sempre o total da origem+tipo selecionados, não só a
  // aba de status ativa (permite controlar erros separadamente por origem/tipo).
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (typeFilter !== 'all') params.event_type = typeFilter;
      if (sourceFilter !== 'all') params.source = sourceFilter;
      const res = await getWebhooks(params);
      setWebhooks((res as any).webhooks || []);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, sourceFilter]);

  useEffect(() => { load(); }, [load]);
  const { user } = useAuthStore();
  const [lastWebhookId, setLastWebhookId] = useState<number | null>(null);
  useLongPoll<WebhookEvent>(
    '/webhooks/poll',
    (items) => { setLastWebhookId(items[0].id); load(); },
    lastWebhookId,
    { enabled: !!user }
  );

  const dateFiltered = filterByDate(webhooks, dateFilter);
  const counts = {
    total:     dateFiltered.length,
    received:  dateFiltered.filter((w) => w.status === 'received').length,
    processed: dateFiltered.filter((w) => w.status === 'processed').length,
    error:     dateFiltered.filter((w) => w.status === 'error').length,
  };
  const filtered = statusFilter === 'all' ? dateFiltered : dateFiltered.filter((w) => w.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Logs de Eventos</h1>
          <p className="text-muted-foreground">Todos os eventos recebidos em tempo real</p>
        </div>
        <Button variant="outline" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Resumo de status — reflete origem+tipo selecionados, independente da aba de status ativa */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-medium text-muted-foreground">Recebidos</span>
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>{loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <div className="text-2xl font-bold">{counts.received}</div>}</CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-medium text-muted-foreground">Processados</span>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>{loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <div className="text-2xl font-bold text-success">{counts.processed}</div>}</CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-medium text-muted-foreground">Erros</span>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>{loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <div className="text-2xl font-bold text-destructive">{counts.error}</div>}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            {/* Filtro de período */}
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro de origem */}
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Origem" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as origens</SelectItem>
                <SelectItem value="ecommerce">E-commerce</SelectItem>
                <SelectItem value="chatbot">Chatbot</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro de tipo */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Tipos</SelectItem>
                <SelectItem value="product.sync">Produto Criado/Atualizado</SelectItem>
                <SelectItem value="product.price_updated">Preço Atualizado (Suri)</SelectItem>
                <SelectItem value="product.stock_updated">Estoque Atualizado (Suri)</SelectItem>
                <SelectItem value="order.created">Pedido Criado</SelectItem>
                <SelectItem value="order.shipped">Pedido Enviado</SelectItem>
                <SelectItem value="order.cancelled">Pedido Cancelado</SelectItem>
                <SelectItem value="cart.abandoned">Carrinho Abandonado</SelectItem>
                <SelectItem value="customer.created">Cliente Criado</SelectItem>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Olist</SelectLabel>
                  <SelectItem value="order-received">order-received</SelectItem>
                  <SelectItem value="order-confirmed">order-confirmed</SelectItem>
                  <SelectItem value="order-sent">order-sent</SelectItem>
                  <SelectItem value="order-canceled">order-canceled</SelectItem>
                  <SelectItem value="product-activated">product-activated</SelectItem>
                  <SelectItem value="product-changed">product-changed</SelectItem>
                  <SelectItem value="prices-changed">prices-changed</SelectItem>
                  <SelectItem value="stocks-changed">stocks-changed</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            {/* Filtro de status */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Status</SelectItem>
                <SelectItem value="received">Recebido</SelectItem>
                <SelectItem value="processed">Processado</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
              </SelectContent>
            </Select>

            {!loading && (
              <span className="text-sm text-muted-foreground self-center ml-auto">
                {filtered.length} evento{filtered.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            className="table-scroll-body"
            style={{ height: '69vh' }}
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recebido em</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhum evento no período selecionado
                    </TableCell>
                  </TableRow>
                ) : filtered.map((w) => (
                  <TableRow key={w.id} className="cursor-pointer hover:bg-accent" onClick={() => setSelected(w)}>
                    <TableCell className="text-muted-foreground text-xs font-mono w-12">#{w.id}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{(w as any).user_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{(w as any).user_email}</div>
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={w.source} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{w.event_type || 'desconhecido'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={(statusVariant(w.status)) as BadgeVariant}
                        className={w.status === 'processed' ? 'border-success text-success' : ''}
                      >
                        {w.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(w.received_at).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="w-12">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setSelected(w); }}>
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
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Payload do Evento
              {selected && <Badge variant="outline" className="text-xs">{selected.event_type || 'desconhecido'}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">#{selected.id}</span></div>
                <div><span className="text-muted-foreground">Status:</span>{' '}
                  <Badge variant={(statusVariant(selected.status)) as BadgeVariant} className={selected.status === 'processed' ? 'border-success text-success' : ''}>
                    {selected.status}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground">Usuário:</span> {(selected as any).user_name || '—'}</div>
                <div><span className="text-muted-foreground">E-mail:</span> {(selected as any).user_email || '—'}</div>
                <div><span className="text-muted-foreground">Origem:</span> <SourceBadge source={selected.source} /></div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Recebido em:</span>{' '}
                  {new Date(selected.received_at).toLocaleString('pt-BR')}
                </div>
                <WebhookErrorDetail status={selected.status} message={selected.error_message} eventType={selected.event_type} />
              </div>
              <div>
                <p className="text-sm font-medium mb-2 text-muted-foreground">Payload JSON</p>
                <pre className="bg-muted rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
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

export default AdminLogs;
