import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, MoreHorizontal, UserCheck, UserX, Loader2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getUsers, createUser, patchUser, deleteUser } from '@/services/api';
import type { User } from '@/types';
import { createSystemNotification } from '@/services/api';

const Clients = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' });
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUsers();
      setUsers((res as any).users || []);
    } catch (err: unknown) {
      toast({ title: 'Erro ao carregar usuários', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createUser(form);
      toast({ title: 'Usuário criado com sucesso!' });
      setOpen(false);
      setForm({ name: '', email: '', password: '', role: 'user' });
      load();
    } catch (err: unknown) {
      toast({ title: 'Erro ao criar usuário', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (user: User) => {
    try {
      await patchUser(user.id, { active: !user.active });
      const isDeactivating = user.active;
      toast({ title: isDeactivating ? 'Usuário desativado' : 'Usuário ativado' });
      // Notify the user when they get deactivated
      if (isDeactivating) {
        // Notifica o usuário específico
        await createSystemNotification({
          type: 'status_change',
          title: 'Conta desativada',
          message: `Sua conta foi desativada pelo administrador. Entre em contato com o suporte para mais informações.`,
          target_user_id: user.id,
          target_role: 'user',
        }).catch(() => {});
        // Notifica admins sobre a ação
        await createSystemNotification({
          type: 'integration_error',
          title: 'Usuário desativado',
          message: `O usuário ${user.name} (${user.email}) foi desativado.`,
          target_role: 'admin',
        }).catch(() => {});
      }
      load();
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Excluir "${user.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteUser(user.id);
      toast({ title: 'Usuário excluído' });
      load();
    } catch (err: unknown) {
      toast({ title: 'Erro ao excluir', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">Gerencie os usuários da plataforma</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Novo Usuário</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Criar Novo Usuário</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input placeholder="Nome completo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" placeholder="email@exemplo.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input type="password" placeholder="Senha inicial" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuário</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar Usuário
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou e-mail..."
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
                <TableHead>E-mail</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum usuário encontrado</TableCell></TableRow>
              ) : filtered.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                      {user.role === 'admin' ? 'Admin' : 'Usuário'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.active ? 'outline' : 'destructive'} className={user.active ? 'border-success text-success' : ''}>
                      {user.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleToggle(user)}>
                          {user.active ? <UserX className="mr-2 h-4 w-4" /> : <UserCheck className="mr-2 h-4 w-4" />}
                          {user.active ? 'Desativar' : 'Ativar'}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(user)}>
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Clients;
