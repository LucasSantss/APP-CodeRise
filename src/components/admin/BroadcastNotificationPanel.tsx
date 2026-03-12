import { useState, useRef } from 'react';
import { Megaphone, Image, Clock, Send, X, Users, ShieldCheck, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createNotification } from '@/services/api';
import { toast } from '@/hooks/use-toast';

type TargetRole = 'user' | 'admin' | 'all';

const BroadcastNotificationPanel = () => {
  const [title, setTitle]           = useState('');
  const [message, setMessage]       = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageBase64, setImageBase64]   = useState('');
  const [targetRole, setTargetRole] = useState<TargetRole>('all');
  const [scheduledAt, setScheduledAt] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [sending, setSending]       = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Limita tamanho a 1MB para não sobrecarregar o banco
    if (file.size > 1024 * 1024) {
      toast({ title: 'Imagem muito grande', description: 'Use uma imagem menor que 1MB.', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setImagePreview(url);
      setImageBase64(url);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImagePreview('');
    setImageBase64('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ title: 'Preencha o título e a mensagem', variant: 'destructive' });
      return;
    }
    if (isScheduled && !scheduledAt) {
      toast({ title: 'Informe a data/hora do agendamento', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      await createNotification({
        type: 'broadcast',
        title: title.trim(),
        message: message.trim(),
        image_url: imageBase64 || undefined,
        target_role: targetRole,
        scheduled_at: isScheduled && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      });

      toast({
        title: isScheduled ? '✅ Notificação agendada!' : '✅ Notificação enviada!',
        description: isScheduled
          ? `Será exibida em ${new Date(scheduledAt).toLocaleString('pt-BR')}`
          : 'A notificação chegará para os usuários em até 30 segundos.',
      });

      setTitle('');
      setMessage('');
      clearImage();
      setScheduledAt('');
      setIsScheduled(false);
      setTargetRole('all');
    } catch (err: unknown) {
      toast({
        title: 'Erro ao enviar notificação',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const targetOptions = [
    { value: 'all',   label: 'Todos os usuários',     icon: Globe },
    { value: 'user',  label: 'Apenas clientes',        icon: Users },
    { value: 'admin', label: 'Apenas administradores', icon: ShieldCheck },
  ];

  const minDateTime = new Date(Date.now() + 60000).toISOString().slice(0, 16);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl gradient-brand flex items-center justify-center shadow-glow-b">
            <Megaphone className="h-4 w-4 text-white" />
          </div>
          <div>
            <CardTitle className="text-base">Enviar Notificação</CardTitle>
            <CardDescription className="text-xs">A mensagem chegará para todos os usuários em tempo real</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Destinatários */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Destinatários</Label>
          <Select value={targetRole} onValueChange={(v) => setTargetRole(v as TargetRole)}>
            <SelectTrigger className="rounded-xl text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targetOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <div className="flex items-center gap-2">
                    <o.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {o.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Título */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Título</Label>
          <Input
            placeholder="Ex: Manutenção programada"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-xl text-sm h-9"
            maxLength={80}
          />
          <p className="text-[10px] text-muted-foreground text-right">{title.length}/80</p>
        </div>

        {/* Mensagem */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Mensagem</Label>
          <Textarea
            placeholder="Escreva a mensagem que os usuários verão..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="rounded-xl text-sm min-h-[90px] resize-none"
            maxLength={500}
          />
          <p className="text-[10px] text-muted-foreground text-right">{message.length}/500</p>
        </div>

        {/* Imagem */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <Image className="h-3.5 w-3.5" /> Imagem (opcional, máx. 1MB)
          </Label>
          {imagePreview ? (
            <div className="relative rounded-xl overflow-hidden border border-border/60">
              <img src={imagePreview} alt="Preview" className="w-full max-h-36 object-cover" />
              <button onClick={clearImage} className="absolute top-2 right-2 h-6 w-6 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition-colors">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full h-20 rounded-xl border-2 border-dashed border-border/60 hover:border-primary/40 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Image className="h-5 w-5" />
              <span className="text-xs">Clique para adicionar imagem</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
        </div>

        {/* Agendamento */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Agendar envio
            </Label>
            <button
              type="button"
              onClick={() => setIsScheduled((v) => !v)}
              className={['relative inline-flex h-5 w-9 items-center rounded-full transition-colors', isScheduled ? 'bg-primary' : 'bg-muted'].join(' ')}
            >
              <span className={['inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform', isScheduled ? 'translate-x-4' : 'translate-x-0.5'].join(' ')} />
            </button>
          </div>
          {isScheduled && (
            <Input type="datetime-local" min={minDateTime} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="rounded-xl text-sm h-9" />
          )}
        </div>

        {/* Preview */}
        {(title || message) && (
          <div className="rounded-xl bg-muted/40 border border-border/40 p-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Preview</p>
            <p className="text-xs font-semibold">{title || '(sem título)'}</p>
            <p className="text-[11px] text-muted-foreground line-clamp-2">{message || '(sem mensagem)'}</p>
          </div>
        )}

        {/* Botão */}
        <Button
          className="w-full rounded-xl gap-2 gradient-brand text-white hover:opacity-90 transition-opacity"
          onClick={handleSend}
          disabled={sending}
        >
          {sending ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Enviando...
            </span>
          ) : (
            <>
              {isScheduled ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {isScheduled ? 'Agendar Notificação' : 'Enviar Agora'}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default BroadcastNotificationPanel;
