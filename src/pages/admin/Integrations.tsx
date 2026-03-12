import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Search, Loader2, RefreshCw,
  CheckCircle2, XCircle, ToggleLeft, ToggleRight, MessageSquare, ShoppingCart,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getIntegrations, patchIntegration } from '@/services/api';
import type { UserIntegration } from '@/types';

type IntegrationRow = UserIntegration & {
  user_name?: string;
  user_email?: string;
  chatbot_connection_status?: 'idle' | 'success' | 'error';
  ecommerce_connection_status?: 'idle' | 'success' | 'error';
};

const ConnectionBadge = ({ status }: { status?: string }) => {
  if (status === 'success')
    return <Badge variant="outline" className="border-success text-success gap-1 text-xs"><CheckCircle2 className="h-3 w-3" /> Conectado</Badge>;
  if (status === 'error')
    return <Badge variant="destructive" className="gap-1 text-xs"><XCircle className="h-3 w-3" /> Falha</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
};

const ToggleBtn = ({ active, loading, label, onToggle }: { active: boolean; loading: boolean; label: string; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={loading}
    title={`${active ? 'Desativar' : 'Ativar'} ${label}`}
    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 border
      ${active
        ? 'border-success/40 bg-success/8 text-success hover:bg-success/15'
        : 'border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground'
      } disabled:cursor-not-allowed disabled:opacity-60`}
  >
    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
      : active ? <ToggleRight className="h-3.5 w-3.5" />
      : <ToggleLeft className="h-3.5 w-3.5" />}
    {active ? 'Ativo' : 'Inativo'}
  </button>
);

const AdminIntegrations = () => {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [toggling, setToggling]         = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getIntegrations();
      setIntegrations((res as any).integrations || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (userId: number, field: 'chatbot_active' | 'ecommerce_active', current: boolean) => {
    const key = `${userId}-${field}`;
    setToggling(t => ({ ...t, [key]: true }));
    try {
      await patchIntegration({ [field]: !current }, userId);
      setIntegrations(prev => prev.map(i => i.user_id === userId ? { ...i, [field]: !current } : i));
      toast({ title: `${field === 'chatbot_active' ? 'Chatbot' : 'E-commerce'} ${!current ? 'ativado' : 'desativado'}` });
    } catch {
      toast({ title: 'Erro ao atualizar', variant: 'destructive' });
    } finally { setToggling(t => ({ ...t, [key]: false })); }
  };

  const filtered = integrations.filter((i) => {
    const matchSearch = !search || (i.user_name || '').toLowerCase().includes(search.toLowerCase()) || (i.user_email || '').toLowerCase().includes(search.toLowerCase());
    const matchPlatform = platformFilter === 'all' || i.ecommerce_platform === platformFilter;
    return matchSearch && matchPlatform;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Integrações</h1>
          <p className="text-muted-foreground">Gerencie as integrações de chatbot e e-commerce de cada cliente</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Clientes',         value: integrations.length,                                                         color: 'text-foreground'         },
          { label: 'Chatbot ativo',    value: integrations.filter(i => i.chatbot_active).length,                           color: 'text-[#56388e]'           },
          { label: 'E-commerce ativo', value: integrations.filter(i => i.ecommerce_active).length,                         color: 'text-[#2f7bb9]'           },
          { label: 'Sem integração',   value: integrations.filter(i => !i.chatbot_active && !i.ecommerce_active).length,   color: 'text-muted-foreground'    },
        ].map(stat => (
          <Card key={stat.label} className="py-3">
            <CardContent className="px-4 py-0">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Clientes</CardTitle>
              <CardDescription>Clique nos toggles para ativar ou desativar cada integração individualmente</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-2 border rounded-lg px-3 h-9 bg-background min-w-[200px]">
                <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  placeholder="Buscar cliente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground"
                />
              </div>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue placeholder="Plataforma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="shopify">Shopify</SelectItem>
                  <SelectItem value="woocommerce">WooCommerce</SelectItem>
                  <SelectItem value="nuvemshop">Nuvemshop</SelectItem>
                  <SelectItem value="tray">Tray</SelectItem>
                  <SelectItem value="vtex">VTEX</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead><div className="flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5 text-[#56388e]" />Chatbot</div></TableHead>
                <TableHead>Conexão Chatbot</TableHead>
                <TableHead><div className="flex items-center gap-1.5"><ShoppingCart className="h-3.5 w-3.5 text-[#2f7bb9]" />E-commerce</div></TableHead>
                <TableHead>Conexão E-commerce</TableHead>
                <TableHead>Plataforma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">Nenhum cliente encontrado</TableCell></TableRow>
              ) : filtered.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{i.user_name || '—'}</div>
                    <div className="text-xs text-muted-foreground">{i.user_email}</div>
                  </TableCell>
                  <TableCell>
                    <ToggleBtn active={i.chatbot_active ?? false} loading={toggling[`${i.user_id}-chatbot_active`] ?? false} label="Chatbot" onToggle={() => toggle(i.user_id, 'chatbot_active', i.chatbot_active ?? false)} />
                  </TableCell>
                  <TableCell><ConnectionBadge status={i.chatbot_connection_status} /></TableCell>
                  <TableCell>
                    <ToggleBtn active={i.ecommerce_active ?? false} loading={toggling[`${i.user_id}-ecommerce_active`] ?? false} label="E-commerce" onToggle={() => toggle(i.user_id, 'ecommerce_active', i.ecommerce_active ?? false)} />
                  </TableCell>
                  <TableCell><ConnectionBadge status={i.ecommerce_connection_status} /></TableCell>
                  <TableCell>
                    {i.ecommerce_platform
                      ? <Badge variant="secondary" className="capitalize">{i.ecommerce_platform}</Badge>
                      : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && filtered.length > 0 && (
            <div className="px-4 py-3 border-t text-xs text-muted-foreground">
              {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}{(search || platformFilter !== 'all') ? ` (filtrado de ${integrations.length})` : ''}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminIntegrations;
