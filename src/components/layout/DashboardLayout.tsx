import { Outlet, useLocation } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from './AppSidebar';
import Header from './Header';
import NotificationPopup from './NotificationPopup';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { usePlatformSettingsPoll } from '@/hooks/use-platform-settings-poll';

const DashboardLayout = () => {
  const location = useLocation();
  const mainRef  = useRef<HTMLElement>(null);

  // Real-time platform settings — polls every 10s, pauses when tab is hidden
  usePlatformSettingsPoll();

  useEffect(() => {
    if (!mainRef.current) return;
    gsap.fromTo(
      mainRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }
    );
  }, [location.pathname]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main ref={mainRef} className="flex-1 p-6 overflow-auto">
            <div className="fixed top-20 right-8 w-96 h-96 rounded-full bg-brand-purple opacity-[0.04] blur-3xl pointer-events-none" />
            <div className="fixed bottom-16 left-16 w-80 h-80 rounded-full bg-brand-blue opacity-[0.04] blur-3xl pointer-events-none" />
            <Outlet />
          </main>
        </div>
      </div>
      <NotificationPopup />
    </SidebarProvider>
  );
};

export default DashboardLayout;
