import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, XCircle, Copy, Terminal, Key, RefreshCw, Info, ArrowRight, ExternalLink, Zap } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { getChatbot, updateChatbot, patchChatbot, regenerateChatbotToken, testSuriConnection } from '@/services/api';
import { CHATBOT_FIELDS, type ChatbotPlatform } from '@/types';
import { usePlatformSettingsStore } from '@/store/platformSettings';
import gsap from 'gsap';
import { useGsapStagger } from '@/hooks/use-gsap';

// ── Tópicos suportados pela Suri ─────────────────────────────────────────────
const SURI_TOPICS = [
  { value: 'OrdersCreated',       label: 'Pedido Criado',         desc: 'Novo pedido realizado na loja' },
  { value: 'OrdersPaid',          label: 'Pedido Pago',           desc: 'Pagamento confirmado' },
  { value: 'OrdersCanceled',      label: 'Pedido Cancelado',      desc: 'Pedido cancelado pelo cliente ou loja' },
  { value: 'OrderLogisticUpdate', label: 'Atualização Logística', desc: 'Rastreamento / status de envio atualizado' },
];

// ─────────────────────────────────────────────────────────────────────────────

const Chatbot = () => {
  const [platform, setPlatform]             = useState<ChatbotPlatform | ''>('');
  const { isPlatformEnabled } = usePlatformSettingsStore();
  const [config, setConfig]                 = useState<Record<string, string>>({});
  const [chatbotActive, setChatbotActive]   = useState(false);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [testing, setTesting]               = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Token e URL dedicados ao chatbot (separados do e-commerce)
  const [chatbotToken, setChatbotToken]     = useState('');
  const [chatbotWebhookUrl, setChatbotWebhookUrl] = useState('');

  // Tópicos para Suri
  const [selectedTopics, setSelectedTopics] = useState<string[]>([
    'OrdersCreated', 'OrdersPaid', 'OrdersCanceled', 'OrderLogisticUpdate',
  ]);

  const [copiedField, setCopiedField]       = useState<string | null>(null);
  const { toast }                           = useToast();

  // ── GSAP ──────────────────────────────────────────────────────────────────
  const containerRef = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1, y: 20, delay: 0.05 });
  const suriCardRef  = useRef<HTMLDivElement>(null);

  // ── Load — usa /chatbot separado do /integrations ─────────────────────────
  useEffect(() => {
    getChatbot()
      .then((res) => {
        const c = (res as any).chatbot;
        if (c) {
          const savedPlatform = c.chatbot_platform || '';
          setPlatform(savedPlatform as ChatbotPlatform);

          const savedConfig = c.chatbot_config || {};
          setConfig(savedConfig);
          setChatbotActive(c.chatbot_active || false);

          const token = c.chatbot_token || '';
          setChatbotToken(token);
          setChatbotWebhookUrl(
            token ? `${window.location.origin}/webhook?token=${token}` : ''
          );

          // Restaura tópicos salvos
          if (savedConfig.suri_topics) {
            try {
              const t = JSON.parse(savedConfig.suri_topics);
              if (Array.isArray(t) && t.length > 0) setSelectedTopics(t);
            } catch { /* usa default */ }
          }

          // Restore last known connection status from saved config
          if (savedConfig._connection_status) {
            setConnectionStatus(savedConfig._connection_status as 'success' | 'error');
          } else if (savedConfig.endpoint) {
            setConnectionStatus('success');
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Anima seção Suri ao aparecer
  useEffect(() => {
    if (platform === 'suri' && suriCardRef.current) {
      gsap.fromTo(
        suriCardRef.current,
        { opacity: 0, y: 18, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'power3.out' }
      );
    }
  }, [platform]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: 'Copiado!' });
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleTopic = (value: string) =>
    setSelectedTopics((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    );

  // ── Regenera token dedicado do chatbot via POST /chatbot ──────────────────
  const handleRegenerateToken = async () => {
    try {
      const res = await regenerateChatbotToken();
      const newToken = (res as any).chatbot_token || '';
      setChatbotToken(newToken);
      setChatbotWebhookUrl(`${window.location.origin}/webhook?token=${newToken}`);
      toast({ title: 'Token do chatbot regenerado!' });
      if (suriCardRef.current) {
        gsap.fromTo(suriCardRef.current,
          { boxShadow: '0 0 0 2px #56388e' },
          { boxShadow: '0 0 0 0px transparent', duration: 1, ease: 'power2.out' }
        );
      }
    } catch {
      toast({ title: 'Erro ao regenerar token', variant: 'destructive' });
    }
  };

  // ── Teste de conexão: via backend (evita CORS + valida body real) ─────────
  const handleTest = async () => {
    const endpoint = config.endpoint?.trim() || '';
    const token    = config.token?.trim()    || '';

    if (!endpoint || !token) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha a URL do Chatbot e o Token de Integração antes de testar.',
        variant: 'destructive',
      });
      return;
    }

    setTesting(true);
    setConnectionStatus('idle');

    try {
      const result = await testSuriConnection(endpoint, token);

      if (result.success) {
        setConnectionStatus('success');
        setConfig((prev) => {
          const updated = { ...prev, _connection_status: 'success', _connection_msg: result.message || '' };
          // Auto-persist so status survives page reload without requiring manual Save
          updateChatbot({ chatbot_platform: platform, chatbot_config: { ...updated, _connection_status: 'success' } }).catch(() => {});
          return updated;
        });
        toast({
          title: '✅ Conexão bem-sucedida!',
          description: result.message || `HTTP ${result.httpStatus}`,
        });
      } else {
        setConnectionStatus('error');
        setConfig((prev) => {
          const updated = { ...prev, _connection_status: 'error', _connection_msg: result.message || '' };
          updateChatbot({ chatbot_platform: platform, chatbot_config: { ...updated, _connection_status: 'error' } }).catch(() => {});
          return updated;
        });
        toast({
          title: '❌ Falha na conexão',
          description: result.message || 'Verifique a URL e o Token de Integração.',
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      setConnectionStatus('error');
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setConfig((prev) => {
        const updated = { ...prev, _connection_status: 'error', _connection_msg: msg };
        updateChatbot({ chatbot_platform: platform, chatbot_config: { ...updated, _connection_status: 'error' } }).catch(() => {});
        return updated;
      });
      toast({
        title: '❌ Erro ao testar conexão',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  // ── Salva via PUT /chatbot — separado do e-commerce ───────────────────────
  const handleSave = async () => {
    if (!platform) {
      toast({ title: 'Selecione uma plataforma', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      // Monta config incluindo tópicos quando for Suri
      const finalConfig: Record<string, string> = { ...config };
      if (platform === 'suri') {
        finalConfig.suri_topics = JSON.stringify(selectedTopics);
      }

      // Persist connection status alongside config so it survives page reload
      finalConfig._connection_status = connectionStatus !== 'idle' ? connectionStatus : '';
      await updateChatbot({
        chatbot_platform: platform,
        chatbot_config:   finalConfig,
      });

      toast({ title: 'Configuração de chatbot salva!' });
    } catch (err: unknown) {
      toast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle ativo via PATCH /chatbot ───────────────────────────────────────
  const handleToggle = async () => {
    try {
      await patchChatbot(!chatbotActive);
      setChatbotActive(!chatbotActive);
      toast({ title: chatbotActive ? 'Chatbot desativado' : 'Chatbot ativado' });
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar status', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    }
  };

  const fields = platform ? CHATBOT_FIELDS[platform]?.fields ?? [] : [];

  // cURL gerado para registro na Suri
  const curlCommand = chatbotWebhookUrl
    ? `curl -X POST "${config.endpoint || '<URL_DO_CHATBOT>'}/webhook/subscribe" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.token || '<TOKEN_DE_INTEGRACAO>'}" \\
  -d '{
    "url": "${chatbotWebhookUrl}",
    "token": "${chatbotToken}",
    "topics": ${JSON.stringify(selectedTopics)}
  }'`
    : '';

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-6 w-auto">

      {/* Header */}
      <div style={{ opacity: 0 }}>
        <h1 className="text-2xl font-bold">Configuração de Chatbot</h1>
        <p className="text-muted-foreground">Conecte sua plataforma de mensagens automatizadas</p>
      </div>

      {/* ── Card: Plataforma + credenciais ── */}
      <Card style={{ opacity: 0 }}>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Plataforma de Chatbot</CardTitle>
              <CardDescription>
                {platform === 'suri'
                  ? 'Cole abaixo as credenciais fornecidas pela Suri Shop'
                  : 'Selecione e configure sua plataforma'}
              </CardDescription>
            </div>
            {platform && (
              <div className="flex items-center gap-2">
                {connectionStatus === 'success' && (
                  <Badge variant={"outline" as const} className="border-success text-success gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Conectado
                  </Badge>
                )}
                {connectionStatus === 'error' && (
                  <Badge variant={"destructive" as const} className="gap-1">
                    <XCircle className="h-3 w-3" /> Falha
                  </Badge>
                )}
                <Button variant={(chatbotActive ? 'default' : 'outline') as BadgeVariant} size="sm" onClick={handleToggle}>
                  {chatbotActive ? 'Ativo' : 'Inativo'}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">

          <div className="space-y-2">
            <Label>Plataforma</Label>
            <Select
              value={platform}
              onValueChange={(v) => { setPlatform(v as ChatbotPlatform); setConfig({}); setConnectionStatus('idle'); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a plataforma de chatbot" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHATBOT_FIELDS)
                  .filter(([key]) => isPlatformEnabled(key))
                  .map(([key, val]) => (
                    <SelectItem key={key} value={key}>
                      <span className="font-medium">{val.label}</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Campos dinâmicos com labels amigáveis para Suri */}
          {fields.map((field) => {
            const isSuriEndpoint = platform === 'suri' && field.key === 'endpoint';
            const isSuriToken    = platform === 'suri' && field.key === 'token';
            return (
              <div key={field.key} className="space-y-2">
                <Label>
                  {isSuriEndpoint ? 'URL do Chatbot' : isSuriToken ? 'Token de Integração' : field.label}
                  {(isSuriEndpoint || isSuriToken) && (
                    <span className="ml-2 text-xs text-muted-foreground font-normal">(fornecido pela Suri)</span>
                  )}
                </Label>
                <Input
                  type={field.type || 'text'}
                  placeholder={
                    isSuriEndpoint
                      ? 'https://cbm-wap-babysuri-xxx.azurewebsites.net/'
                      : isSuriToken
                        ? '5b28a0a8-d399-4295-a2d1-a9f8484887a1'
                        : (field.placeholder || '')
                  }
                  value={config[field.key] || ''}
                  onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                />
              </div>
            );
          })}

          {platform && (
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Testar Conexão
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Seção exclusiva da Suri ── */}
      {platform === 'suri' && (
        <div ref={suriCardRef} style={{ opacity: 0 }} className="space-y-4">

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider px-2">
              Configuração do Webhook
            </span>
            <Separator className="flex-1" />
          </div>

          {/* Fluxo visual */}
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { n: '1', title: 'Credenciais da Suri', desc: 'Cole a URL do Chatbot e Token acima' },
              { n: '2', title: 'URL gerada aqui',     desc: 'Copie a URL do webhook abaixo' },
              { n: '3', title: 'Configure na Suri',   desc: 'Cole URL + Token no painel da Suri' },
            ].map((step, i, arr) => (
              <div key={step.n} className="flex items-start gap-2">
                <div className="h-6 w-6 rounded-full gradient-brand text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {step.n}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.desc}</p>
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 mt-1 hidden sm:block" />
                )}
              </div>
            ))}
          </div>

          {/* ── URL do Webhook do chatbot ── */}
          <Card className="border-[#2f7bb9]/25 bg-gradient-to-br from-[#2f7bb9]/5 to-[#26316a]/5">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#2f7bb9]" />
                <CardTitle className="text-base">URL do Webhook</CardTitle>
                <Badge variant="outline" className="text-[10px] ml-auto border-[#2f7bb9]/30 text-[#2f7bb9]">
                  gerada pela plataforma
                </Badge>
              </div>
              <CardDescription>
                Cole esta URL no campo <strong>URL do Webhook</strong> no painel da Suri Shop.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={chatbotWebhookUrl || 'Salve as configurações para gerar a URL'}
                  readOnly
                  className="font-mono text-xs bg-muted/50"
                />
                <Button
                  variant="outline" size="icon"
                  onClick={() => chatbotWebhookUrl && copy(chatbotWebhookUrl, 'url')}
                  disabled={!chatbotWebhookUrl}
                >
                  {copiedField === 'url'
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-[#2f7bb9]" />
                URL exclusiva do chatbot — <strong>separada</strong> da URL de webhook do e-commerce.
              </p>
            </CardContent>
          </Card>

          {/* ── Token dedicado do chatbot ── */}
          <Card className="border-[#56388e]/25 bg-gradient-to-br from-[#56388e]/5 to-[#2f7bb9]/5">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-[#56388e]" />
                <CardTitle className="text-base">Token do Webhook</CardTitle>
                <Badge variant="outline" className="text-[10px] ml-auto border-[#56388e]/30 text-[#56388e]">
                  gerado pela plataforma
                </Badge>
              </div>
              <CardDescription>
                Cole este token no campo <strong>Token</strong> no painel da Suri para autenticar os eventos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={chatbotToken || 'Nenhum token gerado'}
                  readOnly
                  className="font-mono text-xs bg-muted/50"
                />
                <Button
                  variant="outline" size="icon"
                  onClick={() => chatbotToken && copy(chatbotToken, 'token')}
                  disabled={!chatbotToken}
                >
                  {copiedField === 'token'
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <Copy className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={handleRegenerateToken} title="Regenerar token">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-[#56388e]" />
                Token <strong>exclusivo do chatbot</strong> — independente do token de webhook do e-commerce.
                Regenerar invalida o token anterior imediatamente.
              </p>
            </CardContent>
          </Card>

          {/* ── Tópicos do Webhook ── */}
          <Card className="border-[#26316a]/25 bg-gradient-to-br from-[#26316a]/5 to-[#56388e]/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tópicos do Webhook</CardTitle>
              <CardDescription>
                Selecione os eventos que a Suri deve enviar para sua URL.
                Configure os mesmos tópicos no campo <strong>Tópicos do Webhook</strong> na Suri.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-2">
                {SURI_TOPICS.map((topic) => {
                  const active = selectedTopics.includes(topic.value);
                  return (
                    <button
                      key={topic.value}
                      type="button"
                      onClick={() => toggleTopic(topic.value)}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-200 ${
                        active
                          ? 'border-[#56388e]/50 bg-[#56388e]/8 shadow-sm'
                          : 'border-border/50 bg-background hover:border-[#56388e]/30 hover:bg-muted/30'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-colors ${active ? 'bg-[#56388e] border-[#56388e]' : 'border-muted-foreground/40'}`}>
                        {active && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium leading-tight ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {topic.label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{topic.desc}</p>
                        <code className="text-[10px] text-muted-foreground/60 font-mono">{topic.value}</code>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ── cURL de registro ── */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Registro via API (opcional)</CardTitle>
              </div>
              <CardDescription>
                Use este comando para registrar o webhook programaticamente na Suri, sem acessar o painel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {chatbotWebhookUrl ? (
                <>
                  <Alert className="border-amber-200/50 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/30">
                    <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
                      Os campos <code className="font-mono text-xs bg-amber-100/60 dark:bg-amber-900/40 px-1 rounded">URL_DO_CHATBOT</code> e{' '}
                      <code className="font-mono text-xs bg-amber-100/60 dark:bg-amber-900/40 px-1 rounded">TOKEN_DE_INTEGRACAO</code> são
                      preenchidos automaticamente se você salvou as credenciais acima.
                    </AlertDescription>
                  </Alert>

                  <div className="relative group">
                    <pre className="bg-[#0f1117] text-[#e2e8f0] rounded-xl p-4 text-xs font-mono overflow-x-auto leading-relaxed border border-white/5 shadow-inner whitespace-pre">
                      <code>{curlCommand}</code>
                    </pre>
                    <Button
                      size="sm" variant="secondary"
                      className="absolute top-3 right-3 h-7 gap-1.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => copy(curlCommand, 'curl')}
                    >
                      {copiedField === 'curl'
                        ? <><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Copiado</>
                        : <><Copy className="h-3 w-3" /> Copiar</>}
                    </Button>
                  </div>

                  <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground text-xs" asChild>
                    <a href="https://developers.suri.com.br" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" /> Documentação da API Suri
                    </a>
                  </Button>
                </>
              ) : (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>Salve as configurações para gerar o cURL com sua URL de webhook.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
};

export default Chatbot;
