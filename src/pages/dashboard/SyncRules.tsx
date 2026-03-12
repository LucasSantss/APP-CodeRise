import { useState, useEffect, useCallback } from 'react';
import { useGsapStagger } from '@/hooks/use-gsap';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getSyncRules, createSyncRule, patchSyncRule, deleteSyncRule } from '@/services/api';
import { SYNC_EVENTS, TEMPLATE_VARIABLES, type SyncRule, type SyncEvent } from '@/types';

const SyncRules = () => {
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [newEvent, setNewEvent] = useState<SyncEvent | ''>('');
  const [newTemplate, setNewTemplate] = useState('');
  const [newDelay, setNewDelay] = useState(0);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSyncRules();
      setRules((res as any).rules || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newEvent) {
      toast({ title: 'Selecione um evento', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createSyncRule({ event: newEvent, message_template: newTemplate, delay_minutes: newDelay, active: true });
      toast({ title: 'Regra criada!' });
      setOpen(false);
      setNewEvent('');
      setNewTemplate('');
      setNewDelay(0);
      load();
    } catch (err: unknown) {
      toast({ title: 'Erro ao criar regra', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule: SyncRule) => {
    try {
      await patchSyncRule(rule.id, !rule.active);
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, active: !r.active } : r));
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    }
  };

  const handleDelete = async (rule: SyncRule) => {
    if (!confirm('Excluir esta regra?')) return;
    try {
      await deleteSyncRule(rule.id);
      toast({ title: 'Regra removida' });
      load();
    } catch (err: unknown) {
      toast({ title: 'Erro ao excluir', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    }
  };

  const containerRef = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1, y: 20 });

  return (
    <div ref={containerRef} className="space-y-6">
      <div style={{ opacity: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Regras de Sincronização</h1>
          <p className="text-muted-foreground">Configure as mensagens automáticas</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Nova Regra</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Criar Regra de Sincronização</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Evento</Label>
                <Select value={newEvent} onValueChange={(v) => setNewEvent(v as SyncEvent)}>
                  <SelectTrigger><SelectValue placeholder="Selecione o evento" /></SelectTrigger>
                  <SelectContent>
                    {SYNC_EVENTS.map((e) => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Template da Mensagem</Label>
                <Textarea
                  placeholder="Olá {{customer_name}}, seu pedido #{{order_id}} foi confirmado!"
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value)}
                  rows={3}
                />
                <div className="flex flex-wrap gap-1">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <Badge
                      key={v}
                      variant="secondary"
                      className="text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground"
                      onClick={() => setNewTemplate((t) => t + v)}
                    >
                      {v}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Delay (minutos)</Label>
                <Input type="number" min={0} value={newDelay} onChange={(e) => setNewDelay(Number(e.target.value))} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar Regra
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Nenhuma regra configurada. Crie sua primeira regra de sincronização.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-1 flex-1 mr-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{SYNC_EVENTS.find((e) => e.value === rule.event)?.label || rule.event}</Badge>
                    {rule.delay_minutes > 0 && <Badge variant="secondary">{rule.delay_minutes}min delay</Badge>}
                  </div>
                  {rule.message_template && (
                    <p className="text-sm text-muted-foreground line-clamp-1">{rule.message_template}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Switch checked={rule.active} onCheckedChange={() => handleToggle(rule)} />
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(rule)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default SyncRules;
