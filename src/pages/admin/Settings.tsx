import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageSquare, ShoppingCart, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { getPlatformSettings, patchPlatformSettings } from '@/services/api';

const AdminSettings = () => {
  const [chatbotEnabled, setChatbotEnabled] = useState(true);
  const [ecommerceEnabled, setEcommerceEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingChatbot, setSavingChatbot] = useState(false);
  const [savingEcommerce, setSavingEcommerce] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPlatformSettings();
      setChatbotEnabled(res.settings.chatbot_enabled);
      setEcommerceEnabled(res.settings.ecommerce_enabled);
    } catch (err: unknown) {
      toast({ title: 'Erro ao carregar configurações', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleToggleChatbot = async (value: boolean) => {
    setSavingChatbot(true);
    try {
      const res = await patchPlatformSettings({ chatbot_enabled: value });
      setChatbotEnabled(res.settings.chatbot_enabled);
      toast({ title: value ? 'Integração de Chatbot habilitada' : 'Integração de Chatbot desabilitada' });
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSavingChatbot(false);
    }
  };

  const handleToggleEcommerce = async (value: boolean) => {
    setSavingEcommerce(true);
    try {
      const res = await patchPlatformSettings({ ecommerce_enabled: value });
      setEcommerceEnabled(res.settings.ecommerce_enabled);
      toast({ title: value ? 'Integração de E-commerce habilitada' : 'Integração de E-commerce desabilitada' });
    } catch (err: unknown) {
      toast({ title: 'Erro ao atualizar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setSavingEcommerce(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Gerencie as integrações disponíveis na plataforma</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Habilite ou desabilite cada integração de forma independente. Quando desabilitada,
          a integração fica indisponível para todos os usuários da plataforma.
        </AlertDescription>
      </Alert>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-[#56388e]/10 border border-[#56388e]/20 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-5 w-5 text-[#56388e]" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Integração de Chatbot</CardTitle>
                    <CardDescription className="text-sm mt-0.5">
                      Plataformas de chatbot como Suri — configuração e webhooks de mensageria
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant={chatbotEnabled ? 'outline' : 'secondary'} className={chatbotEnabled ? 'border-success text-success' : ''}>
                    {chatbotEnabled ? 'Habilitada' : 'Desabilitada'}
                  </Badge>
                  {savingChatbot ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch checked={chatbotEnabled} onCheckedChange={handleToggleChatbot} />
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                {chatbotEnabled
                  ? 'A seção "Chatbot" está visível e funcional para todos os usuários.'
                  : 'A seção "Chatbot" está oculta e desativada para todos os usuários.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-[#2f7bb9]/10 border border-[#2f7bb9]/20 flex items-center justify-center flex-shrink-0">
                    <ShoppingCart className="h-5 w-5 text-[#2f7bb9]" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Integração de E-commerce</CardTitle>
                    <CardDescription className="text-sm mt-0.5">
                      Shopify, WooCommerce, Nuvemshop, VTEX, Tray e plataformas customizadas
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant={ecommerceEnabled ? 'outline' : 'secondary'} className={ecommerceEnabled ? 'border-success text-success' : ''}>
                    {ecommerceEnabled ? 'Habilitada' : 'Desabilitada'}
                  </Badge>
                  {savingEcommerce ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch checked={ecommerceEnabled} onCheckedChange={handleToggleEcommerce} />
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                {ecommerceEnabled
                  ? 'A seção "E-commerce" está visível e funcional para todos os usuários.'
                  : 'A seção "E-commerce" está oculta e desativada para todos os usuários.'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AdminSettings;
