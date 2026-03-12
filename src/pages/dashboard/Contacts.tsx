import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getIntegrations } from '@/services/api';

interface SuriContact {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  created_at?: string;
}

const Contacts = () => {
  const [contacts, setContacts] = useState<SuriContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [connected, setConnected] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getIntegrations();
      const i = (res as any).integration;
      if (!i?.suri_endpoint || !i?.suri_token) {
        setConnected(false);
        return;
      }
      setConnected(true);
      const suriRes = await fetch(`${i.suri_endpoint}/contacts`, {
        headers: { Authorization: `Bearer ${i.suri_token}` },
      });
      if (!suriRes.ok) throw new Error(`HTTP ${suriRes.status}`);
      const data = await suriRes.json();
      setContacts(Array.isArray(data) ? data : data.contacts || data.data || []);
    } catch (err: unknown) {
      toast({
        title: 'Erro ao carregar contatos',
        description: err instanceof Error ? err.message : '',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = contacts.filter(
    (c) =>
      !search ||
      (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contatos</h1>
          <p className="text-muted-foreground">Contatos importados na Suri</p>
        </div>
        <Button variant="outline" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {!connected && !loading && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-muted-foreground">Configure a conexão com a Suri para ver os contatos.</p>
            <Badge variant="secondary">Suri não configurada</Badge>
          </CardContent>
        </Card>
      )}

      {connected && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contato..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm border-0 bg-transparent px-0 focus-visible:ring-0"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Cadastrado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum contato encontrado</TableCell></TableRow>
                ) : filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Contacts;
