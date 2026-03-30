import React from 'react';
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
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const { setAuth }             = useAuthStore();
  const navigate                = useNavigate();
  const { toast }               = useToast();
  const formRef                 = useRef<HTMLDivElement>(null);
  const leftRef                 = useRef<HTMLDivElement>(null);
  const orbRef1                 = useRef<HTMLDivElement>(null);
  const orbRef2                 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tl = gsap.timeline();
    if (leftRef.current) {
      tl.fromTo(leftRef.current,
        { opacity: 0, x: -40 },
        { opacity: 1, x: 0, duration: 0.7, ease: 'power3.out' }
      );
    }
    if (formRef.current) {
      tl.fromTo(formRef.current,
        { opacity: 0, x: 40 },
        { opacity: 1, x: 0, duration: 0.7, ease: 'power3.out' },
        '-=0.45'
      );
    }

    // Continuous orb animation
    if (orbRef1.current) {
      gsap.to(orbRef1.current, { x: 30, y: -20, duration: 8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }
    if (orbRef2.current) {
      gsap.to(orbRef2.current, { x: -20, y: 25, duration: 6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1 });
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
    <div className="min-h-screen flex overflow-hidden" style={{ background: '#070512' }}>

      {/* ── Painel esquerdo ── */}
      <div ref={leftRef} style={{ opacity: 0 }}
        className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-14 overflow-hidden">

        {/* Background layers */}
        <div className="absolute inset-0 gradient-aurora opacity-90" />
        {/* Noise texture */}
        <div className="absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.15'/%3E%3C/svg%3E")` }} />
        {/* Grid */}
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: `linear-gradient(rgba(167,139,250,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.5) 1px, transparent 1px)`, backgroundSize: '48px 48px' }} />

        {/* Orbs */}
        <div ref={orbRef1}
          className="absolute top-[10%] right-[5%] w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.45) 0%, transparent 70%)', filter: 'blur(50px)' }} />
        <div ref={orbRef2}
          className="absolute bottom-[5%] left-[10%] w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.4) 0%, transparent 70%)', filter: 'blur(45px)' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(76,29,149,0.3) 0%, transparent 60%)', filter: 'blur(80px)' }} />

        {/* Logo */}
        <div className="relative z-10 stagger-1">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl glass flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.5)]">
              <img src={logo} alt="CodeRise" className="h-5 w-5 object-contain brightness-0 invert" />
            </div>
            <span className="text-white font-bold text-lg" style={{ fontFamily: 'Syne, sans-serif' }}>CodeRise</span>
          </div>
        </div>

        {/* Hero content */}
        <div className="relative z-10 max-w-lg">
          <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 mb-8 stagger-2">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-ping" />
            <span className="text-white/75 text-xs font-medium">Plataforma de integração inteligente</span>
          </div>

          <h1 className="text-[52px] font-extrabold text-white leading-[1.08] mb-6 stagger-3"
            style={{ fontFamily: 'Syne, sans-serif' }}>
            Conecte seu<br />
            <span className="text-gradient-aurora">e-commerce</span><br />
            ao chatbot
          </h1>
          <p className="text-white/50 text-base leading-relaxed mb-10 stagger-4">
            Sincronize pedidos, produtos e clientes automaticamente entre sua loja e qualquer plataforma de mensagens.
          </p>

          <div className="space-y-3.5 stagger-5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3.5 group">
                <div className="h-8 w-8 rounded-xl glass flex items-center justify-center flex-shrink-0 group-hover:bg-violet-500/20 transition-colors">
                  <Icon className="h-3.5 w-3.5 text-violet-300" />
                </div>
                <span className="text-white/60 text-sm group-hover:text-white/80 transition-colors">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Platforms */}
        <div className="relative z-10 stagger-6">
          <p className="text-white/25 text-[10px] mb-3 uppercase tracking-[0.2em] font-semibold">Plataformas suportadas</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <span key={p} className="glass rounded-full px-3.5 py-1.5 text-xs font-medium text-white/55 hover:text-white/80 hover:bg-white/10 transition-all cursor-default">{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Painel direito ── */}
      <div ref={formRef} style={{ opacity: 0 }}
        className="flex-1 flex flex-col items-center justify-center px-8 py-12 relative">

        {/* Background */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 70% 30%, rgba(109,40,217,0.08) 0%, transparent 60%)' }} />
        {/* Border left */}
        <div className="absolute left-0 inset-y-0 w-px pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, rgba(139,92,246,0.3), transparent)' }} />

        <div className="w-full max-w-[380px]">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-12">
            <div className="h-10 w-10 rounded-2xl gradient-brand flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.5)]">
              <img src={logo} alt="CodeRise" className="h-5 w-5 object-contain brightness-0 invert" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none text-white" style={{ fontFamily: 'Syne, sans-serif' }}>CodeRise</p>
              <p className="text-xs text-white/30 mt-0.5">Integration Platform</p>
            </div>
          </div>

          {/* Heading */}
          <div className="mb-9">
            <div className="inline-flex items-center gap-2 text-[11px] font-medium text-violet-400 mb-4 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.2)' }}>
              <Zap className="h-3 w-3" />
              Acesse sua conta
            </div>
            <h1 className="text-3xl font-extrabold text-white mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
              Bem-vindo de volta
            </h1>
            <p className="text-white/35 text-sm">Gerencie todas as suas integrações em um lugar</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-semibold text-white/50 uppercase tracking-wide">E-mail</Label>
              <Input
                id="email" type="email" placeholder="seu@email.com"
                value={email} onChange={(e) => setEmail(e.target.value)} required
                className="h-11 rounded-xl text-white/90 placeholder:text-white/20 transition-all duration-200"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  boxShadow: 'none',
                  outline: 'none',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'rgba(139,92,246,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(139,92,246,0.12)'; }}
                onBlur={(e)  => { e.target.style.borderColor = 'rgba(255,255,255,0.10)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-semibold text-white/50 uppercase tracking-wide">Senha</Label>
              <Input
                id="password" type="password" placeholder="••••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} required
                className="h-11 rounded-xl text-white/90 placeholder:text-white/20 transition-all duration-200"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  boxShadow: 'none',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'rgba(139,92,246,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(139,92,246,0.12)'; }}
                onBlur={(e)  => { e.target.style.borderColor = 'rgba(255,255,255,0.10)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <Button
              type="submit" disabled={loading}
              className="w-full h-11 rounded-xl border-0 text-white font-semibold text-sm transition-all duration-300 group relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4f46e5 100%)', boxShadow: '0 8px 30px -6px rgba(109,40,217,0.55)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 12px 40px -6px rgba(109,40,217,0.7), 0 0 0 1px rgba(139,92,246,0.4)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 30px -6px rgba(109,40,217,0.55)'; }}
            >
              <span className="absolute inset-0 bg-white/0 group-hover:bg-white/[0.08] transition-colors duration-300" />
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="relative flex items-center justify-center gap-2">
                  Entrar na plataforma
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              )}
            </Button>
          </form>

          <p className="mt-12 text-center text-[11px] text-white/15">
            CodeRise Integration © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
};
export default Login;
