import { parseApiError } from '@/lib/parseApiError';

// error_message é reaproveitado pra duas coisas: em status='error' guarda o
// erro técnico da chamada à Suri/Olist; em status='processed' guarda um dump
// JSON do resultado (não é um erro). Só aplica a formatação amigável
// (parseApiError) no primeiro caso — no segundo, mostra como está.
export const WebhookErrorDetail = ({
  status,
  message,
  eventType,
}: {
  status: string;
  message?: string | null;
  eventType?: string | null;
}) => {
  if (!message) return null;

  if (status !== 'error') {
    return (
      <div className="col-span-2 text-muted-foreground text-xs bg-muted rounded p-2 font-mono break-all">
        {message}
      </div>
    );
  }

  const context = (eventType || '').includes('categor') ? 'category'
    : (eventType || '').includes('product') ? 'product'
    : 'general';
  const parsed = parseApiError(message, context as 'product' | 'category' | 'general');

  return (
    <div className="col-span-2 text-xs bg-destructive/10 rounded p-2 space-y-1">
      <p className="font-medium text-destructive">{parsed.title}</p>
      <p className="text-destructive/90">{parsed.description}</p>
      {parsed.hint && (
        <p className="text-[10px] px-1.5 py-1 rounded bg-muted/50 text-muted-foreground border border-border/30">
          💡 {parsed.hint}
        </p>
      )}
      {message !== parsed.description && (
        <details>
          <summary className="text-[10px] text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground">
            🔍 Detalhe técnico
          </summary>
          <p className="text-[10px] mt-0.5 px-1.5 py-1 rounded bg-muted/30 text-muted-foreground/70 border border-border/20 font-mono break-all whitespace-pre-wrap">
            {message}
          </p>
        </details>
      )}
    </div>
  );
};
