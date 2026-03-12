import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { login as apiLogin } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowRight, Zap, ShoppingCart, MessageSquare, Webhook } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import logo from '@/assets/CODERISE.png';
import gsap from 'gsap';

const PLATFORMS = ['Shopify','VTEX','WooCommerce','Nuvemshop','Tray'];
const FEATURES = [
  { icon: ShoppingCart,  text: 'Sincronize pedidos automaticamente' },
  { icon: MessageSquare, text: 'Conecte qualquer chatbot ao seu e-commerce' },
  { icon: Webhook,       text: 'Webhooks em tempo real com 99.9% de uptime' },
];

const Login = () => {
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth }           = useAuthStore();
  const navigate              = useNavigate();
  const { toast }             = useToast();
  const formRef               = useRef<HTMLDivElement>(null);
  const leftRef               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tl = gsap.timeline();
    if (leftRef.current) {
      tl.fromTo(leftRef.current, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' });
    }
    if (formRef.current) {
      tl.fromTo(formRef.current, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' }, '-=0.4');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await apiLogin(email, password);
      if (res.success && res.token && res.user) {
        setAuth(res.token, res.user);
        toast({ title: 'Bem-vindo de volta!' });
        navigate(res.user.role === 'admin' ? '/admin/dashboard' : '/dashboard');
      } else {
        toast({ title: 'Credenciais inválidas', variant: 'destructive' });
      }
    } catch (err: unknown) {
      toast({ title: 'Erro ao conectar', description: err instanceof Error ? err.message : 'Erro de rede', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background overflow-hidden">

      {/* ── Painel esquerdo ── */}
      <div ref={leftRef} style={{ opacity: 0 }} className="hidden lg:flex lg:w-[55%] relative flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 gradient-brand" />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)`, backgroundSize: '32px 32px' }} />
        <div className="absolute top-[-8%] left-[-8%] w-[380px] h-[380px] rounded-full bg-[#2f7bb9] opacity-30 blur-[80px] float-slow" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[300px] h-[300px] rounded-full bg-[#56388e] opacity-25 blur-[70px] float-med" />

        {/* Logo */}
        <div className="relative z-10 stagger-1">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-white/15 glass flex items-center justify-center">
              <img src={logo} alt="CodeRise" className="h-5 w-5 object-contain brightness-0 invert" />
            </div>
            <span className="text-white font-bold text-lg">CodeRise</span>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10 max-w-md">
          <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 mb-7 stagger-2">
            <Zap className="h-3.5 w-3.5 text-yellow-300" />
            <span className="text-white/85 text-xs font-medium">Plataforma de integração inteligente</span>
          </div>
          <h1 className="text-5xl font-bold text-white leading-[1.12] mb-5 stagger-3">
            Conecte seu<br /><span className="text-blue-200">e-commerce</span><br />ao chatbot
          </h1>
          <p className="text-white/65 text-base leading-relaxed mb-8 stagger-4">
            Sincronize pedidos, produtos e clientes automaticamente entre sua loja e qualquer plataforma de mensagens.
          </p>
          <div className="space-y-3 stagger-5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="h-7 w-7 rounded-xl bg-white/10 glass flex items-center justify-center flex-shrink-0">
                  <Icon className="h-3.5 w-3.5 text-white/80" />
                </div>
                <span className="text-white/70 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plataformas */}
        <div className="relative z-10 stagger-6">
          <p className="text-white/40 text-xs mb-3 uppercase tracking-wider">Plataformas suportadas</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <span key={p} className="glass rounded-full px-3 py-1 text-xs font-medium text-white/70">{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Painel direito ── */}
      <div ref={formRef} style={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center px-8 py-12 relative">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none" style={{ background: 'radial-gradient(circle, #56388e 0%, transparent 70%)', transform: 'translate(30%,-30%)' }} />

        <div className="w-full max-w-[380px]">

          {/* Logo mobile */}
          <div className="flex lg:hidden items-center gap-3 mb-10">
            <div className="h-9 w-9 rounded-2xl gradient-brand flex items-center justify-center shadow-brand-sm">
              <img src={logo} alt="CodeRise" className="h-5 w-5 object-contain brightness-0 invert" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none">CodeRise</p>
              <p className="text-xs text-muted-foreground mt-0.5">Integration Platform</p>
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Bem-vindo</h1>
            <p className="text-muted-foreground text-sm">Acesse sua conta para gerenciar integrações</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold">E-mail</Label>
              <Input
                id="email" type="email" placeholder="seu@email.com"
                value={email} onChange={(e) => setEmail(e.target.value)} required
                className="h-11 rounded-xl bg-muted/50 border-border/60 transition-all focus-visible:ring-brand-blue/30"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-semibold">Senha</Label>
              <Input
                id="password" type="password" placeholder="••••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} required
                className="h-11 rounded-xl bg-muted/50 border-border/60 transition-all focus-visible:ring-brand-blue/30"
              />
            </div>
            <Button
              type="submit" disabled={loading}
              className="w-full h-11 rounded-xl gradient-brand border-0 text-white font-semibold shadow-brand-md hover:shadow-brand-lg hover:opacity-95 transition-all duration-300 group"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>Entrar na plataforma<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" /></>
              )}
            </Button>
          </form>

          <p className="mt-10 text-center text-xs text-muted-foreground/60">
            CodeRise Integration © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
};
export default Login;
