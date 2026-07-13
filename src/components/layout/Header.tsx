import { useAuthStore } from '@/store/auth';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, ChevronDown, Moon, Sun, Sparkles } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import NotificationPanel from './NotificationPanel';

const PAGE_TITLES: Record<string, { title: string; sub: string }> = {
  '/dashboard':                  { title: 'Dashboard',      sub: 'Visão geral da sua integração' },
  '/dashboard/chatbot':          { title: 'Chatbot',        sub: 'Configure sua plataforma de mensagens' },
  '/dashboard/ecommerce-config': { title: 'E-commerce',     sub: 'Plataforma e registro de webhook' },
  '/dashboard/logs':             { title: 'Logs',           sub: 'Histórico de eventos em tempo real' },
  '/dashboard/webhooks':         { title: 'Webhooks',       sub: 'Eventos recebidos e status' },
  '/admin/dashboard':            { title: 'Admin',          sub: 'Visão geral da plataforma' },
  '/admin/clients':              { title: 'Clientes',       sub: 'Gerenciamento de usuários' },
  '/admin/integrations':         { title: 'Integrações',    sub: 'Monitor de integrações ativas' },
  '/admin/settings':             { title: 'Configurações',  sub: 'Ajustes da plataforma' },
};

const Header = () => {
  const { user, logout: logoutStore, darkMode, setDarkMode } = useAuthStore();
  const navigate  = useNavigate();
  const location  = useLocation();
  const page      = PAGE_TITLES[location.pathname] || { title: 'CodeRise', sub: '' };
  const initials  = user?.name?.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'U';

  return (
    <header className="h-[58px] border-b border-border bg-background/85 backdrop-blur-xl flex items-center justify-between px-5 shrink-0 sticky top-0 z-30">

      {/* Left */}
      <div className="flex items-center gap-3 min-w-0">
        <SidebarTrigger className="h-8 w-8 rounded-xl hover:bg-accent transition-colors flex-shrink-0 text-muted-foreground hover:text-foreground" />

        <div className="hidden sm:flex items-center gap-2.5 min-w-0">
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold leading-none truncate text-foreground" style={{ fontFamily: 'Syne, sans-serif' }}>{page.title}</h2>
            {page.sub && <p className="text-[11px] text-muted-foreground mt-0.5 leading-none truncate font-light">{page.sub}</p>}
          </div>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1.5">

        {/* Dark mode toggle */}
        <Button
          variant="ghost" size="icon"
          className="h-8 w-8 rounded-xl hover:bg-accent transition-all duration-200 text-muted-foreground hover:text-foreground"
          onClick={() => setDarkMode(!darkMode)}
        >
          {darkMode
            ? <Sun  className="h-4 w-4 text-amber-400" />
            : <Moon className="h-4 w-4" />
          }
        </Button>

        {/* Notifications */}
        <NotificationPanel />

        {/* Divider */}
        <span className="h-5 w-px bg-border mx-1" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost"
              className="h-8 px-2 rounded-xl gap-2 hover:bg-accent transition-all text-foreground/70 hover:text-foreground">
              <div className="h-6 w-6 rounded-lg gradient-brand flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 shadow-[0_0_10px_rgba(139,92,246,0.4)]">
                {initials}
              </div>
              <span className="text-sm font-medium hidden sm:inline max-w-[110px] truncate">{user?.name}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-2xl shadow-xl p-2">
            {/* User info */}
            <div className="px-2.5 py-2.5 mb-1">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl gradient-brand flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-[0_0_14px_rgba(139,92,246,0.4)]">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground" style={{ fontFamily: 'Syne, sans-serif' }}>{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </div>
              <div className="mt-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize"
                  style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}>
                  <Sparkles className="h-2.5 w-2.5" />{user?.role}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { logoutStore(); navigate('/login'); }}
              className="rounded-xl text-destructive focus:text-destructive focus:bg-destructive/10 gap-2 cursor-pointer mt-1 font-medium"
            >
              <LogOut className="h-4 w-4" />
              Sair da plataforma
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Header;
