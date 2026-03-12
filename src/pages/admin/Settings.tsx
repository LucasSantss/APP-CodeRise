import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, CheckCircle2, XCircle, ToggleLeft, ToggleRight, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getIntegrations, patchIntegration } from '@/services/api';
import type { UserIntegration } from '@/types';

type IntegrationRow = UserIntegration & {
  user_name?: string;
  user_email?: string;
  chatbot_connection_status?: string;
  ecommerce_connection_status?: string;
};

const ToggleBtn = ({ active, loading, label, onToggle }: {
  active: boolean; loading: boolean; label: string; onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={loading}
    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 border
      ${active
        ? 'border-success/40 bg-success/8 text-success hover:bg-success/15'
        : 'border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    title={`${active ? 'Desativar' : 'Ativar'} ${label}`}
  >
    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
      : active ? <ToggleRight className="h-3.5 w-3.5" />
      : <ToggleLeft className="h-3.5 w-3.5" />}
    {active ? 'Ativo' : 'Inativo'}
  </button>
);

const AdminSettings = () => {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [loading, setLoading]           = useState(true);
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Configurações</h1>
          <p className="text-muted-foreground">Habilite ou desabilite as integrações disponíveis para cada cliente</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Permissões de Integração</CardTitle>
          </div>
          <CardDescription>
            Controle quais integrações cada cliente pode utilizar na plataforma.
            As alterações têm efeito imediato.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Chatbot</TableHead>
                <TableHead>Status Chatbot</TableHead>
                <TableHead>E-commerce</TableHead>
                <TableHead>Status E-commerce</TableHead>
                <TableHead>Plataforma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : integrations.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">Nenhum cliente encontrado</TableCell></TableRow>
              ) : integrations.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{i.user_name || '—'}</div>
                    <div className="text-xs text-muted-foreground">{i.user_email}</div>
                  </TableCell>

                  <TableCell>
                    <ToggleBtn active={i.chatbot_active ?? false} loading={toggling[`${i.user_id}-chatbot_active`] ?? false} label="Chatbot" onToggle={() => toggle(i.user_id, 'chatbot_active', i.chatbot_active ?? false)} />
                  </TableCell>

                  <TableCell>
                    {i.chatbot_connection_status === 'success' ? (
                      <Badge variant="outline" className="border-success text-success gap-1 text-xs"><CheckCircle2 className="h-3 w-3" /> Conectado</Badge>
                    ) : i.chatbot_connection_status === 'error' ? (
                      <Badge variant="destructive" className="gap-1 text-xs"><XCircle className="h-3 w-3" /> Falha</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <ToggleBtn active={i.ecommerce_active ?? false} loading={toggling[`${i.user_id}-ecommerce_active`] ?? false} label="E-commerce" onToggle={() => toggle(i.user_id, 'ecommerce_active', i.ecommerce_active ?? false)} />
                  </TableCell>

                  <TableCell>
                    {i.ecommerce_connection_status === 'success' ? (
                      <Badge variant="outline" className="border-success text-success gap-1 text-xs"><CheckCircle2 className="h-3 w-3" /> Conectado</Badge>
                    ) : i.ecommerce_connection_status === 'error' ? (
                      <Badge variant="destructive" className="gap-1 text-xs"><XCircle className="h-3 w-3" /> Falha</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {i.ecommerce_platform
                      ? <Badge variant="secondary" className="capitalize">{i.ecommerce_platform}</Badge>
                      : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && integrations.length > 0 && (
            <div className="px-4 py-3 border-t text-xs text-muted-foreground">
              {integrations.length} cliente{integrations.length !== 1 ? 's' : ''} cadastrado{integrations.length !== 1 ? 's' : ''}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSettings;
