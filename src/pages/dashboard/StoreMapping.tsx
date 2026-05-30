import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ArrowRight, Store, Save, Trash2, AlertTriangle, CheckCircle2, RefreshCw, Info, PackageSearch, XCircle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getIntegrations, getChatbot, testEcommerceConnection, testSuriConnection, updateIntegration, updateChatbot, type StoreItem } from '@/services/api';
import { useGsapStagger } from '@/hooks/use-gsap';
import { parseApiError } from '@/lib/parseApiError';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoreMapping {
  ecommerceStoreId: string;
  ecommerceStoreName: string;
  chatbotStoreId: string;
  chatbotStoreName: string;
}

interface SyncResultItem {
  type: string;
  entity: string;
  id?: string;
  name?: string;
  storeId?: string | null;
  message?: string;
  page?: number;
}

interface SyncSummary {
  categories_created: number;
  categories_updated: number;
  products_created: number;
  products_updated: number;
  errors: number;
}

interface SyncCatalogResult {
  success: boolean;
  summary: SyncSummary;
  results: SyncResultItem[];
  resolvedStoreId: string | null;
  platform: string;
  message?: string;
  syncedAt: string;
}

const SYNC_RESULT_KEY = 'coderise_sync_catalog_result';

// ─── Component ───────────────────────────────────────────────────────────────

const StoreMapping = () => {
  const [loading, setLoading] = useState(true);
  const [loadingStores, setLoadingStores] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncCatalogResult | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);

  const [ecommerceStores, setEcommerceStores] = useState<StoreItem[]>([]);
  const [chatbotStores, setChatbotStores] = useState<StoreItem[]>([]);
  const [mappings, setMappings] = useState<StoreMapping[]>([]);

  const [ecommercePlatform, setEcommercePlatform] = useState('');
  const [ecommerceConfig, setEcommerceConfig] = useState<Record<string, string>>({});
  const [suriEndpoint, setSuriEndpoint] = useState('');
  const [suriToken, setSuriToken] = useState('');
  const [chatbotConfig, setChatbotConfig] = useState<Record<string, string>>({});

  const [ecommerceStatus, setEcommerceStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [chatbotStatus, setChatbotStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  const syncPanelRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const containerRef = useGsapStagger<HTMLDivElement>([loading], { stagger: 0.1, y: 20, delay: 0.05 });

  useEffect(() => {
    Promise.all([getIntegrations(), getChatbot()])
      .then(([intRes, chatRes]) => {
        const i = (intRes as any).integration;
        const c = (chatRes as any).chatbot;
        if (i) {
          setEcommercePlatform(i.ecommerce_platform || '');
          const cfg = i.ecommerce_config || {};
          setEcommerceConfig(cfg);
          if (cfg._store_mappings) { try { setMappings(JSON.parse(cfg._store_mappings)); } catch { /* ignore */ } }
          if (cfg._ecommerce_stores) { try { setEcommerceStores(JSON.parse(cfg._ecommerce_stores)); setEcommerceStatus('ok'); } catch { /* ignore */ } }
        }
        if (c) {
          const ccfg = c.chatbot_config || {};
          // Credenciais da Suri: coluna direta ou fallback do chatbot_config
          setSuriEndpoint(c.suri_endpoint || ccfg.endpoint || '');
          setSuriToken(c.suri_token    || ccfg.token    || '');
          setChatbotConfig(ccfg);
          if (ccfg._chatbot_stores) { try { setChatbotStores(JSON.parse(ccfg._chatbot_stores)); setChatbotStatus('ok'); } catch { /* ignore */ } }
        }
      })
      .catch(() => toast({ title: 'Erro ao carregar configurações', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, []);

  // Restaura resultado da última sincronização da memória do navegador
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SYNC_RESULT_KEY);
      if (stored) setSyncResult(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const loadStores = async () => {
    setLoadingStores(true);
    setEcommerceStatus('idle');
    setChatbotStatus('idle');

    const results = await Promise.allSettled([
      (async () => {
        if (!ecommercePlatform || !ecommerceConfig) return [];
        const { _connection_status: _s, _connection_msg: _m, _store_mappings: _mp, _ecommerce_stores: _es, ...cleanConfig } = ecommerceConfig;
        const res = await testEcommerceConnection(ecommercePlatform, cleanConfig);
        if (!res.success) throw new Error(res.message || 'Falha ao conectar e-commerce');
        return res.stores || [];
      })(),
      (async () => {
        if (!suriEndpoint || !suriToken) return [];
        const res = await testSuriConnection(suriEndpoint, suriToken);
        if (!res.success) throw new Error(res.message || 'Falha ao conectar chatbot');
        return res.stores || [];
      })(),
    ]);

    const [ecResult, cbResult] = results;

    if (ecResult.status === 'fulfilled') {
      const stores = ecResult.value as StoreItem[];
      setEcommerceStores(stores);
      setEcommerceStatus('ok');
      const updatedCfg = { ...ecommerceConfig, _ecommerce_stores: JSON.stringify(stores) };
      await updateIntegration({ ecommerce_config: updatedCfg }).catch(() => { });
      setEcommerceConfig(updatedCfg);
    } else {
      setEcommerceStatus('error');
      toast({ title: 'E-commerce', description: (ecResult as any).reason?.message, variant: 'destructive' });
    }

    if (cbResult.status === 'fulfilled') {
      const stores = cbResult.value as StoreItem[];
      setChatbotStores(stores);
      setChatbotStatus('ok');
      if (stores.length > 0) {
        const updatedChatbotCfg = { ...chatbotConfig, _chatbot_stores: JSON.stringify(stores) };
        await updateChatbot({ chatbot_config: updatedChatbotCfg }).catch(() => { });
        setChatbotConfig(updatedChatbotCfg);
      }
    } else {
      setChatbotStatus('error');
      toast({ title: 'Chatbot', description: (cbResult as any).reason?.message, variant: 'destructive' });
    }

    setLoadingStores(false);
  };

  const addMapping = () => {
    if (ecommerceStores.length === 0 || chatbotStores.length === 0) return;
    const ec = ecommerceStores[0];
    const cb = chatbotStores[0];
    const already = mappings.some(m => m.ecommerceStoreId === ec.id);
    if (already) { toast({ title: 'Loja já mapeada', variant: 'destructive' }); return; }
    setMappings(prev => [...prev, { ecommerceStoreId: ec.id, ecommerceStoreName: ec.name, chatbotStoreId: cb.id, chatbotStoreName: cb.name }]);
  };

  const updateMapping = (idx: number, field: keyof StoreMapping, value: string) => {
    setMappings(prev => {
      const next = [...prev];
      const store = field === 'ecommerceStoreId' ? ecommerceStores.find(s => s.id === value) : chatbotStores.find(s => s.id === value);
      next[idx] = {
        ...next[idx],
        [field]: value,
        ...(field === 'ecommerceStoreId' && store ? { ecommerceStoreName: store.name } : {}),
        ...(field === 'chatbotStoreId' && store ? { chatbotStoreName: store.name } : {}),
      };
      return next;
    });
  };

  const removeMapping = (idx: number) => setMappings(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedEcommerceCfg = { ...ecommerceConfig, _store_mappings: JSON.stringify(mappings), ...(ecommerceStores.length > 0 ? { _ecommerce_stores: JSON.stringify(ecommerceStores) } : {}) };
      const updatedChatbotCfg = { ...chatbotConfig, ...(chatbotStores.length > 0 ? { _chatbot_stores: JSON.stringify(chatbotStores) } : {}) };
      await Promise.all([
        updateIntegration({ ecommerce_config: updatedEcommerceCfg }),
        chatbotStores.length > 0 ? updateChatbot({ chatbot_config: updatedChatbotCfg }) : Promise.resolve(),
      ]);
      setEcommerceConfig(updatedEcommerceCfg);
      setChatbotConfig(updatedChatbotCfg);
      toast({ title: '✅ Mapeamentos salvos com sucesso!' });
    } catch (err: unknown) {
      toast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Sync Catalog ─────────────────────────────────────────────────────────
  const handleSyncCatalog = async () => {
    setSyncing(true);
    setShowAllResults(false);
    try {
      const API_BASE = (import.meta as any).env?.VITE_API_URL || '';
      let authToken = '';
      try {
        const { useAuthStore } = await import('@/store/auth');
        authToken = useAuthStore.getState().token || '';
      } catch { /* fallback */ }

      const res = await fetch(`${API_BASE}/sync-catalog`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      // Lê o corpo como texto primeiro para evitar "Unexpected end of JSON input"
      const rawText = await res.text();
      if (!rawText || rawText.trim() === '') {
        throw new Error(`Servidor retornou resposta vazia (HTTP ${res.status}). Verifique se a rota /sync-catalog está configurada no vercel.json.`);
      }
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`Resposta inválida do servidor (HTTP ${res.status}): ${rawText.slice(0, 200)}`);
      }
      const result: SyncCatalogResult = { ...data, syncedAt: new Date().toISOString() };

      setSyncResult(result);
      try { sessionStorage.setItem(SYNC_RESULT_KEY, JSON.stringify(result)); } catch { /* ignore */ }

      if (data.success) {
        const { summary } = data;
        toast({
          title: '✅ Sincronização concluída!',
          description: `${summary.categories_created + summary.categories_updated} categorias · ${summary.products_created + summary.products_updated} produtos · ${summary.errors} erro(s)`,
        });
      } else {
        const errMsg = data.message || 'Erro desconhecido';
        const parsed = parseApiError(errMsg, 'general');
        toast({
          title: parsed.title || 'Sincronização com erros',
          description: parsed.hint ? `${parsed.description} ${parsed.hint}` : parsed.description,
          variant: 'destructive',
        });
      }

      setTimeout(() => syncPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err: unknown) {
      toast({ title: 'Erro na sincronização', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const clearSyncResult = () => {
    setSyncResult(null);
    try { sessionStorage.removeItem(SYNC_RESULT_KEY); } catch { /* ignore */ }
  };

  const getResultIcon = (type: string) => {
    if (type === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
    if (type === 'info') return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  };

  const getResultLabel = (item: SyncResultItem) => {
    const labels: Record<string, string> = {
      category_created: 'Categoria criada', category_updated: 'Categoria atualizada',
      product_created: 'Produto criado', product_updated: 'Produto atualizado',
      error: 'Erro', info: 'Info',
    };
    return labels[item.type] || item.type;
  };

  const getResultBadgeVariant = (type: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (type === 'error') return 'destructive';
    if (type === 'info') return 'secondary';
    if (type.includes('created')) return 'default';
    return 'outline';
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const hasCredentials = ecommercePlatform && suriEndpoint && suriToken;
  const PREVIEW_COUNT = 50;

  return (
    <div ref={containerRef} className="space-y-6">
      <div style={{ opacity: 0 }}>
        <h1 className="text-2xl font-bold">Mapeamento de Lojas</h1>
        <p className="text-muted-foreground">Vincule lojas do E-commerce às lojas do Chatbot para sincronizar produtos</p>
      </div>

      {/* ── Lojas Disponíveis ── */}
      <Card style={{ opacity: 0 }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" /> Lojas Disponíveis</CardTitle>
          <CardDescription>Conecte-se às plataformas para listar as lojas disponíveis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasCredentials && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Configure e salve as credenciais do <strong>E-commerce</strong> e do <strong>Chatbot</strong> antes de carregar as lojas.</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">E-commerce</span>
                {ecommerceStatus === 'ok' && <Badge variant="outline" className="border-green-500 text-green-600 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Conectado</Badge>}
                {ecommerceStatus === 'error' && <Badge variant="destructive" className="text-xs">Erro</Badge>}
              </div>
              {ecommerceStores.length > 0 ? (
                <ul className="space-y-1">{ecommerceStores.map(s => (
                  <li key={s.id} className="text-sm flex items-center gap-2 text-muted-foreground">
                    <Store className="h-3 w-3 shrink-0" /><span className="truncate">{s.name}</span>
                    <code className="text-xs bg-muted px-1 rounded ml-auto shrink-0">#{s.id}</code>
                  </li>
                ))}</ul>
              ) : <p className="text-xs text-muted-foreground italic">Nenhuma loja carregada</p>}
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Chatbot (Suri)</span>
                {chatbotStatus === 'ok' && <Badge variant="outline" className="border-green-500 text-green-600 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Conectado</Badge>}
                {chatbotStatus === 'error' && <Badge variant="destructive" className="text-xs">Erro</Badge>}
              </div>
              {chatbotStores.length > 0 ? (
                <ul className="space-y-1">{chatbotStores.map(s => (
                  <li key={s.id} className="text-sm flex items-center gap-2 text-muted-foreground">
                    <Store className="h-3 w-3 shrink-0" /><span className="truncate">{s.name}</span>
                    <code className="text-xs bg-muted px-1 rounded ml-auto shrink-0">#{s.id}</code>
                  </li>
                ))}</ul>
              ) : <p className="text-xs text-muted-foreground italic">Nenhuma loja carregada</p>}
            </div>
          </div>

          <Button onClick={loadStores} disabled={loadingStores || !hasCredentials} variant="outline">
            {loadingStores ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando...</> : <><RefreshCw className="mr-2 h-4 w-4" />Carregar Lojas</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── Mapeamentos ── */}
      <Card style={{ opacity: 0 }}>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ArrowRight className="h-5 w-5" /> Mapeamentos</CardTitle>
              <CardDescription>Cada linha define de qual loja do e-commerce os produtos serão sincronizados para qual loja do chatbot</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={addMapping} disabled={ecommerceStores.length === 0 || chatbotStores.length === 0}>
              + Adicionar Mapeamento
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="mb-2">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Cada mapeamento define: <strong>qual loja do E-commerce</strong> (Store ID <code className="bg-muted px-1 rounded">{ecommerceConfig.store_id || '—'}</code>) envia produtos para <strong>qual loja/depósito do Chatbot</strong>.
            </AlertDescription>
          </Alert>

          {mappings.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm space-y-2">
              <Store className="h-8 w-8 mx-auto opacity-30" />
              <p>Nenhum mapeamento configurado.</p>
              <p className="text-xs">Carregue as lojas e clique em <strong>+ Adicionar Mapeamento</strong>.</p>
            </div>
          ) : mappings.map((m, idx) => (
            <div key={idx} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 flex-wrap">
              <div className="flex-1 min-w-[150px]">
                <p className="text-xs text-muted-foreground mb-1">Loja E-commerce</p>
                <Select value={m.ecommerceStoreId} onValueChange={(v) => updateMapping(idx, 'ecommerceStoreId', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecionar loja" /></SelectTrigger>
                  <SelectContent>{ecommerceStores.map(s => <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-xs text-muted-foreground ml-1">#{s.id}</span></SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-4" />
              <div className="flex-1 min-w-[150px]">
                <p className="text-xs text-muted-foreground mb-1">Loja Chatbot (Suri)</p>
                <Select value={m.chatbotStoreId} onValueChange={(v) => updateMapping(idx, 'chatbotStoreId', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecionar loja" /></SelectTrigger>
                  <SelectContent>{chatbotStores.map(s => <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-xs text-muted-foreground ml-1">#{s.id}</span></SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive mt-4 shrink-0" onClick={() => removeMapping(idx)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {mappings.length > 0 && (
            <Button onClick={handleSave} disabled={saving} className="mt-2">
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : <><Save className="mr-2 h-4 w-4" />Salvar Mapeamentos</>}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Sincronização de Catálogo ── */}
      <Card style={{ opacity: 0 }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5" />
            Sincronização de Catálogo
          </CardTitle>
          <CardDescription>
            Lê todas as categorias e produtos do e-commerce e cria/atualiza na plataforma do chatbot.
            Os resultados são exibidos abaixo e ficam na memória do navegador até você fechar a aba.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasCredentials && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Configure as credenciais do <strong>E-commerce</strong> e do <strong>Chatbot</strong> antes de sincronizar.</AlertDescription>
            </Alert>
          )}

          {ecommercePlatform && ecommercePlatform !== 'nuvemshop' && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                A sincronização completa de catálogo está disponível apenas para <strong>Nuvemshop</strong> no momento.
                Outras plataformas continuam recebendo produtos via webhooks normalmente.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={handleSyncCatalog}
              disabled={syncing || ecommerceStatus !== 'ok' || chatbotStatus !== 'ok'}
              className="gap-2"
            >
              {syncing
                ? <><Loader2 className="h-4 w-4 animate-spin" />Sincronizando...</>
                : <><PackageSearch className="h-4 w-4" />Sincronizar Catálogo</>}
            </Button>

            {syncResult && !syncing && (
              <Button variant="ghost" size="sm" onClick={clearSyncResult} className="text-muted-foreground gap-1">
                <RotateCcw className="h-3.5 w-3.5" />Limpar resultados
              </Button>
            )}
          </div>

          {syncing && (
            <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>Buscando e sincronizando categorias e produtos... Pode levar alguns minutos dependendo do tamanho do catálogo.</span>
            </div>
          )}

          {/* ── Results Panel ── */}
          {syncResult && !syncing && (
            <div ref={syncPanelRef} className="space-y-3">

              {/* Summary */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    {syncResult.success
                      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                    Resultado da sincronização
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(syncResult.syncedAt).toLocaleString('pt-BR')}
                    {syncResult.resolvedStoreId && (
                      <> · Loja Suri: <code className="bg-muted px-1 rounded">#{syncResult.resolvedStoreId}</code></>
                    )}
                  </span>
                </div>

                {syncResult.summary && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      { value: syncResult.summary.categories_created, label: 'Cat. criadas', color: 'green' },
                      { value: syncResult.summary.categories_updated, label: 'Cat. atualizadas', color: 'blue' },
                      { value: syncResult.summary.products_created, label: 'Prod. criados', color: 'green' },
                      { value: syncResult.summary.products_updated, label: 'Prod. atualizados', color: 'blue' },
                      { value: syncResult.summary.errors, label: 'Erros', color: syncResult.summary.errors > 0 ? 'red' : 'gray' },
                    ].map(({ value, label, color }) => (
                      <div key={label} className={`rounded-md border p-2 text-center ${color === 'green' ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900' :
                          color === 'blue' ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900' :
                            color === 'red' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900' :
                              'bg-muted border-border'
                        }`}>
                        <p className={`text-lg font-bold ${color === 'green' ? 'text-green-700 dark:text-green-400' :
                            color === 'blue' ? 'text-blue-700 dark:text-blue-400' :
                              color === 'red' ? 'text-destructive' :
                                'text-muted-foreground'
                          }`}>{value}</p>
                        <p className={`text-xs ${color === 'green' ? 'text-green-600 dark:text-green-500' :
                            color === 'blue' ? 'text-blue-600 dark:text-blue-500' :
                              color === 'red' ? 'text-red-600 dark:text-red-400' :
                                'text-muted-foreground'
                          }`}>{label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {syncResult.message && !syncResult.success && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">{syncResult.message}</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Items list */}
              {syncResult.results && syncResult.results.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">{syncResult.results.length} eventos registrados</span>
                    <span className="text-xs text-muted-foreground">Memória do navegador · limpo ao fechar a aba</span>
                  </div>

                  <div className="divide-y max-h-96 overflow-y-auto">
                    {(showAllResults ? syncResult.results : syncResult.results.slice(0, PREVIEW_COUNT)).map((item, idx) => {
                      // Formata mensagem de erro de forma amigável
                      const isError = item.type === 'error';
                      let displayMessage = item.message;
                      let errorHint: string | undefined;
                      const rawErrorMessage = isError ? item.message : undefined;
                      if (isError && item.message) {
                        const context = item.entity === 'category' ? 'category'
                          : item.entity === 'product' ? 'product' : 'general';
                        const parsed = parseApiError(item.message, context as 'product' | 'category' | 'general');
                        displayMessage = parsed.description;
                        errorHint = parsed.hint;
                      }

                      return (
                        <div key={idx} className="flex items-start gap-3 px-4 py-2 text-xs hover:bg-muted/20 transition-colors">
                          <div className="mt-0.5">{getResultIcon(item.type)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={getResultBadgeVariant(item.type)} className="text-xs py-0 h-4 shrink-0">
                                {getResultLabel(item)}
                              </Badge>
                              {item.name && <span className="font-medium truncate">{item.name}</span>}
                              {item.id && <code className="text-muted-foreground bg-muted px-1 rounded shrink-0">#{item.id}</code>}
                            </div>
                            {displayMessage && (
                              <p className="text-muted-foreground mt-0.5 break-words">{displayMessage}</p>
                            )}
                            {errorHint && (
                              <p className="text-[10px] mt-0.5 px-1.5 py-1 rounded bg-muted/50 text-muted-foreground/70 border border-border/30">
                                💡 {errorHint}
                              </p>
                            )}
                            {rawErrorMessage && rawErrorMessage !== displayMessage && (
                              <details className="mt-0.5">
                                <summary className="text-[10px] text-muted-foreground/50 cursor-pointer select-none hover:text-muted-foreground/80">
                                  🔍 Detalhe técnico
                                </summary>
                                <p className="text-[10px] mt-0.5 px-1.5 py-1 rounded bg-muted/30 text-muted-foreground/60 border border-border/20 font-mono break-all whitespace-pre-wrap">
                                  {rawErrorMessage}
                                </p>
                              </details>
                            )}
                          </div>
                          {item.storeId && <code className="text-muted-foreground bg-muted px-1 rounded shrink-0 mt-0.5">loja #{item.storeId}</code>}
                        </div>
                      );
                    })}
                  </div>

                  {syncResult.results.length > PREVIEW_COUNT && (
                    <div className="bg-muted/40 px-4 py-2 border-t">
                      <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground gap-1" onClick={() => setShowAllResults(v => !v)}>
                        {showAllResults
                          ? <><ChevronUp className="h-3.5 w-3.5" />Mostrar menos</>
                          : <><ChevronDown className="h-3.5 w-3.5" />Mostrar todos os {syncResult.results.length} eventos</>}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StoreMapping;