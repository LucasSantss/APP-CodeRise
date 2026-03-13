import { useAuthStore } from '@/store/auth';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, ChevronDown, Moon, Sun } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import NotificationPanel from './NotificationPanel';

const PAGE_TITLES: Record<string, { title: string; sub: string }> = {
  '/dashboard':                  { title: 'Dashboard',      sub: 'Visão geral da sua integração' },
  '/dashboard/chatbot':      { title: 'Chatbot',        sub: 'Configure sua plataforma de mensagens' },
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
    <header className="h-14 border-b border-border/50 bg-card/70 backdrop-blur-md flex items-center justify-between px-5 shrink-0 sticky top-0 z-30">

      <div className="flex items-center gap-3 min-w-0">
        <SidebarTrigger className="h-8 w-8 rounded-xl hover:bg-muted transition-colors flex-shrink-0" />
        <div className="hidden sm:block animate-slide-up min-w-0">
          <h2 className="text-sm font-bold leading-none truncate">{page.title}</h2>
          {page.sub && <p className="text-xs text-muted-foreground mt-0.5 leading-none truncate">{page.sub}</p>}
        </div>
      </div>

      <div className="flex items-center gap-1">

        {/* Modo escuro */}
        <Button
          variant="ghost" size="icon"
          className="h-8 w-8 rounded-xl hover:bg-muted transition-all duration-200"
          onClick={() => setDarkMode(!darkMode)}
        >
          {darkMode
            ? <Sun  className="h-4 w-4 text-amber-400" />
            : <Moon className="h-4 w-4 text-slate-400" />
          }
        </Button>

        {/* Notificações */}
        <NotificationPanel />

        <div className="h-4 w-px bg-border mx-0.5" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 px-2 rounded-xl gap-2 hover:bg-muted transition-all">
              <div className="h-6 w-6 rounded-lg gradient-brand flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {initials}
              </div>
              <span className="text-sm font-semibold hidden sm:inline max-w-[110px] truncate">{user?.name}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-2xl border-border/60 shadow-brand-md p-1.5 animate-scale-in">
            <div className="px-2.5 py-2 mb-1">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl gradient-brand flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </div>
              <div className="mt-2.5">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />{user?.role}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { logoutStore(); navigate('/login'); }}
              className="rounded-xl text-destructive focus:text-destructive focus:bg-destructive/10 gap-2 cursor-pointer mt-1"
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
