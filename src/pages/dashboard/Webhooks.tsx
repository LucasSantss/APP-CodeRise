import { useLongPoll } from '@/hooks/use-polling';
import { useAuthStore } from '@/store/auth';
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Copy, RefreshCw, ExternalLink, Loader2, ShoppingCart, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getIntegrations, getWebhooks, deleteWebhooks, getChatbot } from '@/services/api';
import type { UserIntegration, WebhookEvent } from '@/types';
import { useGsapStagger } from '@/hooks/use-gsap';
import gsap from 'gsap';

const statusVariant = (status: string) => {
  if (status === 'received') return 'outline';
  if (status === 'error') return 'destructive';
  return 'secondary';
};

const PLATFORM_DOCS: Record<string, string> = {
  Shopify: 'https://help.shopify.com/en/manual/orders/notifications/webhooks',
  WooCommerce: 'https://woocommerce.com/document/webhooks/',
  Tray: 'https://developers.tray.com.br/webhooks',
  Nuvemshop: 'https://tiendanube.github.io/api-documentation/resources/webhook',
  VTEX: 'https://developers.vtex.com/docs/guides/vtex-io-documentation-1-developing-storefront-apps',
};

const INTEGRATION_FIELDS: { key: string; label: string }[] = [
  { key: 'suri_active',        label: 'Suri Ativo' },
  { key: 'ecommerce_platform', label: 'Plataforma' },
  { key: 'ecommerce_active',   label: 'E-commerce Ativo' },
  { key: 'created_at',         label: 'Criado em' },
  { key: 'updated_at',         label: 'Atualizado em' },
];

const formatValue = (key: string, value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✅ Sim' : '❌ Não';
  if (key === 'created_at' || key === 'updated_at' || key === 'received_at') return new Date(value as string).toLocaleString('pt-BR');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const normalizeWebhook = (webhook: any): any => {
  const normalized = { ...webhook };
  if (typeof normalized.payload === 'string') {
    try { normalized.payload = JSON.parse(normalized.payload); } catch { /* keep as is */ }
  }
  if (!normalized.event_type && normalized.payload?.event_type) normalized.event_type = normalized.payload.event_type;
  return normalized;
};

const UserWebhooks = () => {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<UserIntegration | null>(null);
  const [chatbotToken, setChatbotToken] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const baseUrl = window.location.origin;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string,string> = { limit: '10' };
      if (statusFilter !== 'all') params.status = statusFilter;
      const [i, w, c] = await Promise.all([getIntegrations(), getWebhooks(params), getChatbot()]);
      setIntegration((i as any).integration || null);
      setChatbotToken((c as any).chatbot?.chatbot_token || null);
      const lista = (w as any).webhooks ?? (w as any).data ?? (w as any).rows ?? [];
      const normalized = Array.isArray(lista) ? lista.map(normalizeWebhook) : [];
      setWebhooks(normalized.slice(0, 10));

    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const { user } = useAuthStore();
  const [lastWebhookId, setLastWebhookId] = useState<number | null>(null);
  useLongPoll<WebhookEvent>(
    '/webhooks/poll',
    (items) => {
      // Prepend apenas os novos eventos sem refazer o fetch completo
      setLastWebhookId(items[0].id);
      setWebhooks(prev => {
        const ids = new Set(prev.map(e => e.id));
        const novos = items.filter(e => !ids.has(e.id));
        return novos.length > 0 ? [...novos, ...prev] : prev;
      });
    },
    lastWebhookId,
    { enabled: !!user }
  );



  // ── GSAP ─────────────────────────────────────────────────────────────────
  const containerRef = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1, y: 20, delay: 0.05 });

  // Animate new webhook rows when they appear
  useEffect(() => {
    const rows = document.querySelectorAll('.webhook-row');
    if (rows.length === 0) return;
    gsap.fromTo(rows,
      { opacity: 0, x: -8 },
      { opacity: 1, x: 0, duration: 0.35, stagger: 0.04, ease: 'power2.out' }
    );
  }, [webhooks]);

  const ecommerceUrl = integration?.webhook_token
    ? `${baseUrl}/webhook?token=${integration.webhook_token}`
    : '';
  const chatbotUrl = chatbotToken
    ? `${baseUrl}/webhook?token=${chatbotToken}`
    : '';

  const copyField = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: 'Copiado!' });
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div ref={containerRef} className="space-y-6">

      {/* Header */}
      <div style={{ opacity: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhooks</h1>
          <p className="text-muted-foreground">URL do webhook e eventos recebidos</p>
        </div>
        <Button variant="outline" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* URLs dos Webhooks — E-commerce e Chatbot separados */}
      <div style={{ opacity: 0 }} className="grid gap-4 sm:grid-cols-2">

        {/* E-commerce token */}
        <Card className="border-[#2f7bb9]/25 bg-gradient-to-br from-[#2f7bb9]/5 to-[#26316a]/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-[#2f7bb9]" />
              <CardTitle className="text-base">Webhook E-commerce</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Configure no painel da sua loja virtual
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={loading ? 'Carregando...' : (ecommerceUrl || 'Sem token gerado')}
                readOnly
                className="font-mono text-xs bg-muted/50"
              />
              <Button variant="outline" size="icon"
                onClick={() => ecommerceUrl && copyField(ecommerceUrl, 'ecommerce')}
                disabled={!ecommerceUrl}>
                {copiedField === 'ecommerce'
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Documentação:</p>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(PLATFORM_DOCS).map(([name, url]) => (
                  <Button key={name} variant="ghost" className="justify-start gap-1 h-7 text-xs px-2" asChild>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-2.5 w-2.5" /> {name}
                    </a>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chatbot token */}
        <Card className="border-[#56388e]/25 bg-gradient-to-br from-[#56388e]/5 to-[#2f7bb9]/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#56388e]" />
              <CardTitle className="text-base">Webhook Chatbot</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Configure no painel da Suri ou plataforma de chatbot
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={loading ? 'Carregando...' : (chatbotUrl || 'Configure o chatbot primeiro')}
                readOnly
                className="font-mono text-xs bg-muted/50"
              />
              <Button variant="outline" size="icon"
                onClick={() => chatbotUrl && copyField(chatbotUrl, 'chatbot')}
                disabled={!chatbotUrl}>
                {copiedField === 'chatbot'
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Token exclusivo do chatbot — independente do e-commerce.
              Gerencie em <strong>Configuração de Chatbot</strong>.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Dados da Integração */}
      <Card style={{ opacity: 0 }}>
        <CardHeader><CardTitle>Dados da Integração</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !integration ? (
            <p className="text-center text-muted-foreground py-8">Nenhuma integração configurada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>{INTEGRATION_FIELDS.map(({ label }) => <TableHead key={label}>{label}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  {INTEGRATION_FIELDS.map(({ key }) => (
                    <TableCell key={key} className="text-sm text-muted-foreground font-mono break-all">
                      {formatValue(key, (integration as any)[key])}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Eventos Recebidos */}
      <Card style={{ opacity: 0 }}>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Eventos Recebidos <span className="text-sm text-muted-foreground">(últimos 10)</span></CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="received">Recebido</SelectItem>
                <SelectItem value="processed">Processado</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Header fixo */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">ID</TableHead>
                <TableHead className="w-[60px]">Usuário</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead>Recebido em</TableHead>
                <TableHead>Payload</TableHead>
              </TableRow>
            </TableHeader>
          </Table>
          {/* Body com scroll 50vh */}
          <div className="flex flex-col h-[50vh]">
            <div className="flex-1 overflow-y-auto scrollbar-y-hidden">
              <div className="min-w-max">
                <Table>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : webhooks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum evento recebido</TableCell>
                      </TableRow>
                    ) : webhooks.map((w) => (
                      <TableRow
                        key={w.id}
                        className="webhook-row cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedWebhook(w)}
                      >
                        <TableCell className="text-xs font-mono w-[60px]">{w.id}</TableCell>
                        <TableCell className="w-[60px]">
                          <Badge variant="outline" className="text-xs">{w.event_type?.toString() || 'desconhecido'}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(w.status)} className={w.status === 'received' ? 'border-success text-success' : ''}>
                            {w.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{w.error_message || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(w.received_at).toLocaleString('pt-BR')}</TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono truncate max-w-[200px]">
                          {w.payload ? JSON.stringify(w.payload) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-x-dark">
              <div className="min-w-max h-[1px]" />
            </div>
        </CardContent>
      </Card>

      {/* Dados do Evento Selecionado */}
      <Card style={{ opacity: 0 }}>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Dados do Evento</CardTitle>
          {selectedWebhook && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedWebhook(null)}>Fechar</Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {selectedWebhook ? (
            (() => {
              const raw = (selectedWebhook as any).payload;
              let payload: any = raw;
              if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { /* keep */ } }
              if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
                return (
                  <Table>
                    <TableHeader><TableRow>{Object.keys(payload).map((key) => <TableHead key={key} className="capitalize text-xs">{key.replace(/_/g, ' ')}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>
                      <TableRow>{Object.keys(payload).map((key) => <TableCell key={key} className="text-sm text-muted-foreground font-mono break-all">{formatValue(key, payload[key])}</TableCell>)}</TableRow>
                    </TableBody>
                  </Table>
                );
              }
              return (
                <Table>
                  <TableHeader><TableRow><TableHead>Campo</TableHead><TableHead>Valor</TableHead></TableRow></TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground font-mono">payload</TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono break-all">{formatValue('payload', payload)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              );
            })()
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Campo</TableHead><TableHead>Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground py-8">Selecione um evento na lista acima</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UserWebhooks;
