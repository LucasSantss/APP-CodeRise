/// <reference types="vite/client" />
/**
 * useLongPoll — tempo real via long polling
 *
 * O backend segura a conexão até haver dado novo (ou timeout ~20s).
 * O frontend só "acorda" quando chegar algo — zero atualização desnecessária.
 * Pausa quando a aba está em segundo plano, retoma imediatamente ao voltar.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseLongPollOptions {
  enabled?: boolean;
  params?: Record<string, string>;
}

export function useLongPoll<T extends { id: number }>(
  endpoint: string,
  onData: (items: T[]) => void,
  lastId: number | null,
  options: UseLongPollOptions = {}
) {
  const { enabled = true, params = {} } = options;
  const { token } = useAuthStore();

  const abortRef  = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const lastIdRef = useRef(lastId);
  const onDataRef = useRef(onData);
  const paramsRef = useRef(params);

  // Só sincroniza quando o chamador já sabe um id real — evita que um
  // re-render com lastId ainda null apague o baseline 0 estabelecido
  // internamente em loop() (ver comentário lá).
  useEffect(() => { if (lastId !== null) lastIdRef.current = lastId; }, [lastId]);
  useEffect(() => { onDataRef.current = onData; },  [onData]);
  useEffect(() => { paramsRef.current = params; },  [params]);

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
        lastIdRef.current = Math.max(...items.map((i) => i.id));
        onDataRef.current(items);
      } else if (lastIdRef.current === null) {
        // Sem after_id, o backend responde na hora (rota de carga inicial),
        // sem segurar a conexão. Sem isso, enquanto não existir nenhum item
        // (ex: conta sem notificações), o loop nunca ganha um after_id e
        // dispara de novo instantaneamente pra sempre. Estabelece baseline
        // 0 aqui pra que a próxima chamada já entre no long poll de verdade.
        lastIdRef.current = 0;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      await new Promise(r => setTimeout(r, 3000));
    }

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
