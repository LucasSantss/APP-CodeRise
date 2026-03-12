import { useLocation } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import logo from '@/assets/CODERISE.png';
import { LayoutDashboard, Users, Link2, Settings, Webhook, MessageSquare, ShoppingCart, ScrollText, Zap } from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { useAuthStore } from '@/store/auth';

const adminItems = [
  { title: 'Dashboard',     url: '/admin/dashboard',    icon: LayoutDashboard },
  { title: 'Clientes',      url: '/admin/clients',      icon: Users },
  { title: 'Integrações',   url: '/admin/integrations', icon: Link2 },
  { title: 'Configurações', url: '/admin/settings',     icon: Settings },
];

const userItems = [
  { title: 'Dashboard',  url: '/dashboard',                  icon: LayoutDashboard },
  { title: 'Chatbot',    url: '/dashboard/suri-config',      icon: MessageSquare },
  { title: 'E-commerce', url: '/dashboard/ecommerce-config', icon: ShoppingCart },
  { title: 'Logs',       url: '/dashboard/logs',             icon: ScrollText },
  { title: 'Webhooks',   url: '/dashboard/webhooks',         icon: Webhook },
];

const AppSidebar = () => {
  const { state }  = useSidebar();
  const collapsed  = state === 'collapsed';
  const location   = useLocation();
  const { user }   = useAuthStore();
  const isAdmin    = user?.role === 'admin';
  const items      = isAdmin ? adminItems : userItems;

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      {/* Fundo com gradiente da marca */}
      <div className="absolute inset-0 gradient-sidebar-bg pointer-events-none" />
      {/* Orb decorativo */}
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-brand-blue opacity-10 blur-3xl pointer-events-none" />

      {/* Header */}
      <SidebarHeader className="relative h-[60px] flex items-center border-b border-sidebar-border/40">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl gradient-brand flex items-center justify-center shadow-glow-b flex-shrink-0">
              <img src={logo} alt="CodeRise" className="h-4.5 w-4.5 object-contain brightness-0 invert" style={{ height: '1.1rem', width: '1.1rem' }} />
            </div>
            <div>
              <h1 className="text-[13px] font-bold text-sidebar-accent-foreground leading-none">CodeRise</h1>
              <p className="text-[10px] text-sidebar-muted/70 leading-none mt-0.5">Integration Platform</p>
            </div>
          </div>
        ) : (
          <div className="h-8 w-8 rounded-xl gradient-brand flex items-center justify-center shadow-glow-b mx-auto">
            <Zap className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </SidebarHeader>

      {/* Nav */}
      <SidebarContent className="relative px-2 py-3">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[9px] uppercase tracking-[0.12em] text-sidebar-muted/60 px-2 mb-1.5">
              {isAdmin ? 'Administração' : 'Meu Painel'}
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {items.map((item, i) => {
                const isActive =
                  location.pathname === item.url ||
                  (item.url !== '/dashboard' && item.url !== '/admin/dashboard' &&
                   location.pathname.startsWith(item.url));

                return (
                  <SidebarMenuItem
                    key={item.title}
                    className="stagger-1"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === '/dashboard' || item.url === '/admin/dashboard'}
                        className={[
                          'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium',
                          'transition-all duration-200 relative group',
                          isActive
                            ? 'bg-white/12 text-white nav-bar'
                            : 'text-sidebar-foreground/65 hover:bg-white/7 hover:text-sidebar-foreground/90',
                        ].join(' ')}
                        activeClassName=""
                      >
                        <div className={[
                          'flex items-center justify-center h-[26px] w-[26px] rounded-lg flex-shrink-0 transition-all duration-200',
                          isActive ? 'gradient-brand shadow-glow-b' : 'bg-white/8 group-hover:bg-white/14',
                        ].join(' ')}>
                          <item.icon className="h-3.5 w-3.5" />
                        </div>
                        {!collapsed && <span>{item.title}</span>}
                        {isActive && !collapsed && (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400 pulse-ring" />
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      {!collapsed && (
        <SidebarFooter className="relative border-t border-sidebar-border/40 p-3px-4">
          <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 pulse-ring flex-shrink-0" />
              <span className="text-[11px] font-medium text-sidebar-foreground/75">Sistema operacional</span>
            </div>
            <p className="text-[10px] text-sidebar-muted/55 mt-1">Webhooks ativos • Tempo real</p>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
};

export default AppSidebar;
