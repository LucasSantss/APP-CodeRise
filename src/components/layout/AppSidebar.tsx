import { useLocation } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import logo from '@/assets/CODERISE.png';
import { LayoutDashboard, Users, Link2, Settings, Webhook, MessageSquare, ShoppingCart, ScrollText, Zap, Activity, GitMerge } from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { useAuthStore } from '@/store/auth';
import { usePlatformSettingsStore, CHATBOT_PLATFORMS, ECOMMERCE_PLATFORMS } from '@/store/platformSettings';

const adminItems = [
  { title: 'Dashboard',     url: '/admin/dashboard',    icon: LayoutDashboard },
  { title: 'Clientes',      url: '/admin/clients',      icon: Users },
  { title: 'Integrações',   url: '/admin/integrations', icon: Link2 },
  { title: 'Configurações', url: '/admin/settings',     icon: Settings },
];

const AppSidebar = () => {
  const { state }  = useSidebar();
  const collapsed  = state === 'collapsed';
  const location   = useLocation();
  const { user }   = useAuthStore();
  const { isPlatformEnabled } = usePlatformSettingsStore();
  const isAdmin = user?.role === 'admin';

  const anyChatbotEnabled   = CHATBOT_PLATFORMS.some((p) => isPlatformEnabled(p));
  const anyEcommerceEnabled = ECOMMERCE_PLATFORMS.some((p) => isPlatformEnabled(p));

  const userItems = [
    { title: 'Dashboard',  url: '/dashboard',                  icon: LayoutDashboard, show: true },
    { title: 'Chatbot',    url: '/dashboard/chatbot',          icon: MessageSquare,   show: anyChatbotEnabled },
    { title: 'E-commerce', url: '/dashboard/ecommerce-config', icon: ShoppingCart,    show: anyEcommerceEnabled },
    { title: 'Lojas',       url: '/dashboard/store-mapping',     icon: GitMerge,        show: anyChatbotEnabled && anyEcommerceEnabled },
    { title: 'Logs',       url: '/dashboard/logs',             icon: ScrollText,      show: true },
    { title: 'Webhooks',   url: '/dashboard/webhooks',         icon: Webhook,         show: true },
  ].filter((item) => item.show);

  const items = isAdmin ? adminItems : userItems;

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      {/* Background */}
      <div className="absolute inset-0 gradient-sidebar-bg pointer-events-none" />
      {/* Aurora orbs */}
      <div className="absolute -top-20 -left-10 w-52 h-52 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(109,40,217,0.25) 0%, transparent 70%)', filter: 'blur(40px)' }} />
      <div className="absolute bottom-10 -right-10 w-40 h-40 rounded-full pointer-events-none aurora-spin"
        style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.20) 0%, transparent 70%)', filter: 'blur(30px)' }} />

      {/* Header */}
      <SidebarHeader className="relative h-[58px] flex items-center border-b border-white/[0.06] px-2">
        {!collapsed ? (
          <div className="flex items-center gap-3 stagger-1">
            <div className="h-8 w-8 rounded-xl gradient-brand flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.5)] flex-shrink-0">
              <img src={logo} alt="CodeRise" className="h-4 w-4 object-contain brightness-0 invert" />
            </div>
            <div>
              <h1 className="text-[13px] font-bold text-white leading-none" style={{ fontFamily: 'Syne, sans-serif' }}>CodeRise</h1>
              <p className="text-[10px] text-white/30 leading-none mt-0.5 font-light">Integration Platform</p>
            </div>
          </div>
        ) : (
          <div className="h-8 w-8 rounded-xl gradient-brand flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.5)] mx-auto">
            <Zap className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent className={`relative py-4 ${collapsed ? 'px-1' : 'px-3'}`}>
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[9px] uppercase tracking-[0.18em] text-white/20 px-2 mb-2 font-semibold">
              {isAdmin ? 'Administração' : 'Navegação'}
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={`space-y-1 ${collapsed ? 'flex flex-col items-center' : ''}`}>
              {items.map((item, i) => {
                const isActive =
                  location.pathname === item.url ||
                  (item.url !== '/dashboard' && item.url !== '/admin/dashboard' &&
                   location.pathname.startsWith(item.url));

                return (
                  <SidebarMenuItem key={item.title} style={{ animationDelay: `${i * 0.06}s` }} className="stagger-1">
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === '/dashboard' || item.url === '/admin/dashboard'}
                        activeClassName=""
                        className={[
                          'flex items-center rounded-xl text-[13px] font-medium',
                          'transition-all duration-200 relative group overflow-hidden',
                          collapsed ? 'justify-center px-0 py-2.5 w-full' : 'gap-3 px-3 py-2.5',
                          isActive
                            ? 'text-white nav-bar'
                            : 'text-white/40 hover:text-white/75',
                        ].join(' ')}
                      >
                        {/* Active background */}
                        {isActive && (
                          <span className="absolute inset-0 rounded-xl bg-white/[0.08] border border-white/[0.12]" />
                        )}
                        {/* Hover background */}
                        {!isActive && (
                          <span className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.05] transition-colors duration-200" />
                        )}

                        <div className={[
                          'relative flex items-center justify-center h-[28px] w-[28px] rounded-lg flex-shrink-0 transition-all duration-200',
                          isActive
                            ? 'gradient-brand shadow-[0_0_14px_rgba(139,92,246,0.45)]'
                            : 'bg-white/[0.06] group-hover:bg-white/[0.10]',
                        ].join(' ')}>
                          <item.icon className={`h-3.5 w-3.5 transition-colors ${isActive ? 'text-white' : 'text-white/50 group-hover:text-white/75'}`} />
                        </div>

                        {!collapsed && (
                          <span className="relative font-medium">{item.title}</span>
                        )}

                        {isActive && !collapsed && (
                          <span className="relative ml-auto flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-400" />
                          </span>
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
        <SidebarFooter className="relative border-t border-white/[0.06] p-3">
          <div className="rounded-xl border border-white/[0.08] px-3 py-2.5"
            style={{ background: 'rgba(139,92,246,0.07)' }}>
            <div className="flex items-center gap-2">
              <Activity className="h-3 w-3 text-emerald-400 flex-shrink-0" />
              <span className="text-[11px] font-medium text-white/55">Sistema operacional</span>
            </div>
            <div className="mt-1.5 h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 data-stream" />
            </div>
            <p className="text-[9px] text-white/25 mt-1">Webhooks ativos • Tempo real</p>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
};

export default AppSidebar;
