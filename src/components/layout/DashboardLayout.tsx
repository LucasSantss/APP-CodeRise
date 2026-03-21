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

  usePlatformSettingsPoll();

  useEffect(() => {
    if (!mainRef.current) return;
    gsap.fromTo(
      mainRef.current,
      { opacity: 0, y: 12, scale: 0.995 },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out' }
    );
  }, [location.pathname]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main ref={mainRef} className="flex-1 p-6 overflow-auto relative">
            {/* Aurora background orbs */}
            <div className="fixed top-24 right-12 w-[500px] h-[500px] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(109,40,217,0.06) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="fixed bottom-20 left-20 w-[400px] h-[400px] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.05) 0%, transparent 70%)', filter: 'blur(50px)' }} />
            <div className="fixed top-1/2 left-1/2 w-[600px] h-[600px] rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.03) 0%, transparent 70%)', filter: 'blur(80px)' }} />
            <Outlet />
          </main>
        </div>
      </div>
      <NotificationPopup />
    </SidebarProvider>
  );
};

export default DashboardLayout;
