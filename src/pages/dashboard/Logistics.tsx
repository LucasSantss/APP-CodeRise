import { useState, useEffect } from 'react';
import { useGsapStagger } from '@/hooks/use-gsap';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2, CheckCircle2, Copy, AlertTriangle, Plug, XCircle, Truck, Clock,
} from 'lucide-react';
import { LOGISTICS_FIELDS, type LogisticsPlatform } from '@/types';
import { useToast } from '@/hooks/use-toast';
import {
  getLogistics, updateLogistics, patchLogistics, testLogisticsConnection,
  getChatbot,
} from '@/services/api';

// Campos mínimos para gerar o token dos Correios — os códigos de serviço
// (SEDEX/PAC) só são necessários na hora de cotar o frete, não no teste de
// conexão, então não bloqueiam o botão "Testar Conexão".
const TEST_REQUIRED_FIELDS: Record<LogisticsPlatform, string[]> = {
  correios: ['usuario', 'senha', 'cartaoPostagem'],
  smart_envios: [],
};

const Logistics = () => {
  const [chatbotPlatform, setChatbotPlatform] = useState<string | null>(null);
  const [platform, setPlatform]               = useState<LogisticsPlatform | ''>('');
  const [config, setConfig]                   = useState<Record<string, string>>({ ambiente: 'producao' });
  const [logisticsActive, setLogisticsActive] = useState(false);
  const [logisticsToken, setLogisticsToken]   = useState('');
  const [loading, setLoading]                 = useState(true);
  const [saving, setSaving]                   = useState(false);

  const [testing, setTesting]                 = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMsg, setConnectionMsg]     = useState('');

  const { toast } = useToast();

  useEffect(() => {
    Promise.all([
      getLogistics().then((res) => (res as any).logistics),
      getChatbot().then((res) => (res as any).chatbot).catch(() => null),
    ])
      .then(([logistics, chatbot]) => {
        if (logistics) {
          setPlatform(logistics.logistics_platform || '');
          const savedConfig = logistics.logistics_config || {};
          setConfig({ ambiente: 'producao', ...savedConfig });
          setLogisticsActive(!!logistics.logistics_active);
          setLogisticsToken(logistics.logistics_token || '');
          if (savedConfig._connection_status) {
            setConnectionStatus(savedConfig._connection_status as 'success' | 'error');
            setConnectionMsg(savedConfig._connection_msg || '');
          }
        }
        setChatbotPlatform(chatbot?.chatbot_platform || null);
      })
      .finally(() => setLoading(false));
  }, []);

  const meta = platform ? LOGISTICS_FIELDS[platform] : null;
  const fields = meta ? meta.fields : [];
  const logisticsUrl = logisticsToken
    ? `${window.location.origin}/logistics-quote?token=${logisticsToken}`
    : '';
  const isSuriSelected = chatbotPlatform === 'suri';

  const handleSave = async () => {
    if (!platform) {
      toast({ title: 'Selecione uma transportadora', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { _connection_status, _connection_msg, ...configToSave } = config;
      await updateLogistics({
        logistics_platform: platform,
        logistics_config: {
          ...configToSave,
          _connection_status: connectionStatus !== 'idle' ? connectionStatus : undefined,
          _connection_msg: connectionMsg || undefined,
        },
      });
      toast({ title: 'Configuração de logística salva com sucesso!' });
    } catch (err: unknown) {
      toast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    try {
      await patchLogistics(!logisticsActive);
      setLogisticsActive(!logisticsActive);
      toast({ title: logisticsActive ? 'Logística desativada' : 'Logística ativada' });
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    }
  };

  const handleTest = async () => {
    if (!platform) {
      toast({ title: 'Selecione uma transportadora', variant: 'destructive' });
      return;
    }
    const requiredKeys = TEST_REQUIRED_FIELDS[platform] || [];
    const requiredFields = (meta?.fields || []).filter(f => requiredKeys.includes(f.key));
    const missing = requiredFields.filter(f => !config[f.key]?.trim());
    if (missing.length > 0) {
      toast({
        title: 'Campos obrigatórios',
        description: `Preencha: ${missing.map(f => f.label).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setTesting(true);
    setConnectionStatus('idle');
    setConnectionMsg('');

    try {
      const { _connection_status: _s, _connection_msg: _m, ...configToTest } = config;
      const result = await testLogisticsConnection(platform, configToTest);
      const msg = result.message || (result.success ? 'Conexão estabelecida com sucesso!' : 'Falha na conexão.');
      setConnectionStatus(result.success ? 'success' : 'error');
      setConnectionMsg(msg);
      setConfig((prev) => {
        const updated = { ...prev, _connection_status: result.success ? 'success' : 'error', _connection_msg: msg };
        updateLogistics({ logistics_platform: platform, logistics_config: updated }).catch(() => {});
        return updated;
      });
      if (result.success) {
        toast({ title: '✅ Conexão bem-sucedida!' });
      } else {
        toast({ title: 'Falha na conexão', description: msg, variant: 'destructive' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setConnectionStatus('error');
      setConnectionMsg(msg);
      toast({ title: 'Erro ao testar', description: msg, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'URL copiada!' });
  };

  const containerRef = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1, y: 20, delay: 0.05 });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-6">
      <div style={{ opacity: 0 }}>
        <h1 className="text-2xl font-bold">Logística</h1>
        <p className="text-muted-foreground">Configure a transportadora usada na cotação de frete do chatbot</p>
      </div>

      {!isSuriSelected && (
        <Alert style={{ opacity: 0 }}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            A integração de Logística é consumida pela tela <strong>&quot;Integração via API&quot;</strong> de
            Logística do chatbot <strong>Suri</strong>. Selecione a plataforma Suri em <strong>Chatbot</strong>{' '}
            para usar a URL gerada abaixo. Você ainda pode configurar e testar a transportadora normalmente.
          </AlertDescription>
        </Alert>
      )}

      {/* Configuração da transportadora */}
      <Card style={{ opacity: 0 }}>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Transportadora</CardTitle>
              <CardDescription>Selecione e configure a transportadora de logística</CardDescription>
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
                <Button variant={(logisticsActive ? 'default' : 'outline') as BadgeVariant} size="sm" onClick={handleToggle}>
                  {logisticsActive ? 'Ativado' : 'Desativado'}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Transportadora</Label>
            <Select
              value={platform}
              onValueChange={(v) => {
                setPlatform(v as LogisticsPlatform);
                setConfig({ ambiente: 'producao' });
                setConnectionStatus('idle');
                setConnectionMsg('');
              }}
            >
              <SelectTrigger><SelectValue placeholder="Selecione a transportadora" /></SelectTrigger>
              <SelectContent>
                {Object.entries(LOGISTICS_FIELDS).map(([key, val]) => (
                  <SelectItem key={key} value={key} disabled={!val.available}>
                    {val.label}{!val.available ? ' (em breve)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {platform === 'correios' && (
            <div className="space-y-2">
              <Label>Ambiente</Label>
              <Select
                value={config.ambiente || 'producao'}
                onValueChange={(v) => setConfig((prev) => ({ ...prev, ambiente: v, _connection_status: '', _connection_msg: '' }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="producao">Produção</SelectItem>
                  <SelectItem value="homologacao">Homologação</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {fields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label>{field.label}</Label>
              <Input
                type={field.type || 'text'}
                placeholder={field.placeholder}
                value={config[field.key] || ''}
                onChange={(e) => {
                  setConfig(prev => ({ ...prev, [field.key]: e.target.value, _connection_status: '', _connection_msg: '' }));
                  setConnectionStatus('idle');
                  setConnectionMsg('');
                }}
              />
            </div>
          ))}

          {platform && meta?.available && (
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing || saving}
                className={
                  connectionStatus === 'success'
                    ? 'border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950'
                    : connectionStatus === 'error'
                    ? 'border-destructive text-destructive hover:bg-destructive/10'
                    : ''
                }
              >
                {testing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testando...</>
                ) : connectionStatus === 'success' ? (
                  <><CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />Conexão OK</>
                ) : connectionStatus === 'error' ? (
                  <><XCircle className="mr-2 h-4 w-4" />Falha — Testar novamente</>
                ) : (
                  <><Plug className="mr-2 h-4 w-4" />Testar Conexão</>
                )}
              </Button>

              <Button onClick={handleSave} disabled={saving || testing}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          )}

          {connectionStatus !== 'idle' && connectionMsg && (
            <p className={`text-xs mt-1 ${connectionStatus === 'success' ? 'text-green-500' : 'text-destructive'}`}>
              {connectionMsg}
            </p>
          )}

          {platform === 'smart_envios' && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>Integração com Smart Envios em desenvolvimento — disponível em breve.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* URL da API de Logística */}
      {platform && meta?.available && logisticsToken && (
        <Card>
          <CardHeader>
            <CardTitle>URL da Integração de Logística</CardTitle>
            <CardDescription>
              Cole esta URL na tela &quot;Integração via API&quot; de Logística do chatbot Suri
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>API URL</Label>
              <div className="flex gap-2">
                <Input value={logisticsUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copyText(logisticsUrl)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O token de autenticação já vai embutido na URL — não é necessário configurar nenhum Header
                adicional na tela da Suri.
              </p>
            </div>

            <Alert>
              <Truck className="h-4 w-4" />
              <AlertDescription>
                A Suri fará um <strong>GET</strong> nesta URL para validar o endpoint e, durante o fluxo de
                compra, um <strong>POST</strong> com os itens e o endereço do cliente para calcular as opções
                de entrega (SEDEX/PAC) via Correios.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Logistics;
