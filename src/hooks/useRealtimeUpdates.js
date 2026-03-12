import { useEffect, useCallback, useState } from 'react';

export function useRealtimeUpdates(onUpdate, onError) {
  const connectSSE = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('Token não encontrado');
      return;
    }

    const eventSource = new EventSource(
      `/api/realtime-stream?token=${encodeURIComponent(token)}`
    );

    eventSource.onopen = () => {
      console.log('✅ Conexão SSE estabelecida');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📨 Evento recebido:', data);
        
        if (onUpdate) {
          onUpdate(data);
        }
      } catch (err) {
        console.error('Erro ao processar evento:', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ Erro SSE:', error);
      eventSource.close();
      
      if (onError) onError(error);

      // Reconectar após 5 segundos
      setTimeout(() => {
        console.log('🔄 Tentando reconectar SSE...');
        connectSSE();
      }, 5000);
    };

    return eventSource;
  }, [onUpdate, onError]);

  useEffect(() => {
    const eventSource = connectSSE();
    
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [connectSSE]);
}

// Exemplo em seu componente React
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

export function WebhooksList() {
  const [webhooks, setWebhooks] = useState([]);

  useRealtimeUpdates((event) => {
    // Atualiza quando recebe evento
    if (event.table === 'user_webhooks') {
      if (event.action === 'INSERT') {
        setWebhooks(prev => [event.data, ...prev]);
      } else if (event.action === 'UPDATE') {
        setWebhooks(prev =>
          prev.map(w => w.id === event.data.id ? event.data : w)
        );
      }
    }
  });

  return (
    <div>
      {webhooks.map(webhook => (
        <div key={webhook.id}>{webhook.event_type}</div>
      ))}
    </div>
  );
}