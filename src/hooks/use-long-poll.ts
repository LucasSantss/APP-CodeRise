/**
 * useLongPoll — atualização em tempo real via long polling
 *
 * Funcionamento:
 * 1. Faz GET /endpoint?after_id=<último_id_conhecido>
 * 2. O backend SEGURA a conexão até haver dado novo (ou timeout de ~20s)
 * 3. Se veio dado novo → atualiza estado e dispara próxima requisição imediatamente
 * 4. Se timeout → dispara próxima requisição imediatamente (zero espera)
 * 5. Pausa quando a aba está em segundo plano, retoma ao voltar
 *
 * Resultado: atualização instantânea quando há evento, zero polling desnecessário.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseLongPollOptions {
  /** Se false, não inicia. Útil para aguardar autenticação. */
  enabled?: boolean;
  /** Parâmetros extras de query (ex: status filter) */
  params?: Record<string, string>;
}

/**
 * @param endpoint  ex: '/webhooks/poll'  ou  '/notifications'
 * @param onData    chamado com os novos itens quando chegar dado
 * @param lastId    ID do último item conhecido pelo cliente
 */
export function useLongPoll<T extends { id: number }>(
  endpoint: string,
  onData: (items: T[]) => void,
  lastId: number | null,
  options: UseLongPollOptions = {}
) {
  const { enabled = true, params = {} } = options;
  const { token } = useAuthStore();

  const abortRef   = useRef<AbortController | null>(null);
  const activeRef  = useRef(false);
  const lastIdRef  = useRef(lastId);
  const onDataRef  = useRef(onData);
  const paramsRef  = useRef(params);

  useEffect(() => { lastIdRef.current = lastId; },   [lastId]);
  useEffect(() => { onDataRef.current = onData; },   [onData]);
  useEffect(() => { paramsRef.current = params; },   [params]);

  const stop = useCallback(() => {
    activeRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const loop = useCallback(async () => {
    if (!token || !activeRef.current) return;

    const qs = new URLSearchParams(paramsRef.current);
    if (lastIdRef.current !== null) qs.set('after_id', String(lastIdRef.current));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${API_BASE}${endpoint}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: T[] = data.webhooks ?? data.notifications ?? [];

      if (items.length > 0) {
        onDataRef.current(items);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // parou intencionalmente
      // Erro de rede — espera 3s antes de tentar de novo
      await new Promise(r => setTimeout(r, 3000));
    }

    // Próxima iteração imediata (backend já garante o delay de 20s)
    if (activeRef.current) loop();
  }, [token, endpoint]);

  useEffect(() => {
    if (!enabled || !token) { stop(); return; }

    activeRef.current = true;
    loop();

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        activeRef.current = true;
        loop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, token, loop, stop]);
}
