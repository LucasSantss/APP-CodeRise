/**
 * usePlatformSettingsPoll
 *
 * Faz polling periódico em /platform-settings e atualiza o store global.
 * Pausa quando a aba está em segundo plano, retoma ao voltar.
 * Intervalo padrão: 10 segundos — garante que mudanças do admin
 * apareçam para todos os usuários em até 10s sem precisar recarregar.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import { usePlatformSettingsStore } from '@/store/platformSettings';
import { getPlatformSettings } from '@/services/api';

const POLL_INTERVAL_MS = 60_000; // 60s — dado raramente muda, 10s era agressivo

export function usePlatformSettingsPoll() {
  const { token } = useAuthStore();
  const { setSettings } = usePlatformSettingsStore();

  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await getPlatformSettings();
      setSettings(res.platforms || {});
    } catch {
      // silently ignore — store retains last known state
    }
  }, [setSettings]);

  const schedule = useCallback(() => {
    clear();
    if (!activeRef.current) return;
    timerRef.current = setTimeout(async () => {
      await fetchOnce();
      schedule(); // reschedule after each fetch completes
    }, POLL_INTERVAL_MS);
  }, [fetchOnce, clear]);

  const start = useCallback(async () => {
    activeRef.current = true;
    await fetchOnce(); // immediate fetch on start
    schedule();
  }, [fetchOnce, schedule]);

  const stop = useCallback(() => {
    activeRef.current = false;
    clear();
  }, [clear]);

  useEffect(() => {
    if (!token) { stop(); return; }
    start();

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start(); // re-fetch immediately when tab becomes visible
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, start, stop]);
}
