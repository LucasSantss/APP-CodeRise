import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { parseApiError } from '@/lib/parseApiError';
import type { SyncResultItem } from '@/types';

export type { SyncResultItem };

const getResultIcon = (type: string) => {
  if (type === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  if (type === 'info') return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
};

const getResultLabel = (item: SyncResultItem) => {
  const labels: Record<string, string> = {
    category_created: 'Categoria criada', category_updated: 'Categoria atualizada',
    product_created: 'Produto criado', product_updated: 'Produto atualizado',
    error: 'Erro', info: 'Info',
  };
  return labels[item.type] || item.type;
};

const getResultBadgeVariant = (type: string): BadgeVariant => {
  if (type === 'error') return 'destructive';
  if (type === 'info') return 'secondary';
  if (type.includes('created')) return 'default';
  return 'outline';
};

// Uma linha de resultado de sincronização (categoria/produto criado, atualizado
// ou erro) — usado tanto na sincronização assistida (botão manual) quanto no
// histórico da sincronização automática/agendada, pra manter a mesma
// identificação de erro (mensagem amigável + dica + detalhe técnico) nos dois lugares.
export const SyncResultRow = ({ item }: { item: SyncResultItem }) => {
  const isError = item.type === 'error';
  let displayMessage = item.message;
  let errorHint: string | undefined;
  const rawErrorMessage = isError ? item.message : undefined;
  if (isError && item.message) {
    const context = item.entity === 'category' ? 'category'
      : item.entity === 'product' ? 'product' : 'general';
    const parsed = parseApiError(item.message, context as 'product' | 'category' | 'general');
    displayMessage = parsed.description;
    errorHint = parsed.hint;
  }

  return (
    <div className="flex items-start gap-3 px-4 py-2 text-xs hover:bg-muted/20 transition-colors">
      <div className="mt-0.5">{getResultIcon(item.type)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={getResultBadgeVariant(item.type)} className="text-xs py-0 h-4 shrink-0">
            {getResultLabel(item)}
          </Badge>
          {item.name != null && <span className="font-medium truncate">{typeof item.name === 'string' ? item.name : ((item.name as any)?.pt || (item.name as any)?.es || String(item.name))}</span>}
          {item.id && <code className="text-muted-foreground bg-muted px-1 rounded shrink-0">#{item.id}</code>}
        </div>
        {displayMessage && (
          <p className="text-muted-foreground mt-0.5 break-words">{displayMessage}</p>
        )}
        {errorHint && (
          <p className="text-[10px] mt-0.5 px-1.5 py-1 rounded bg-muted/50 text-muted-foreground/70 border border-border/30">
            💡 {errorHint}
          </p>
        )}
        {rawErrorMessage && rawErrorMessage !== displayMessage && (
          <details className="mt-0.5">
            <summary className="text-[10px] text-muted-foreground/50 cursor-pointer select-none hover:text-muted-foreground/80">
              🔍 Detalhe técnico
            </summary>
            <p className="text-[10px] mt-0.5 px-1.5 py-1 rounded bg-muted/30 text-muted-foreground/60 border border-border/20 font-mono break-all whitespace-pre-wrap">
              {rawErrorMessage}
            </p>
          </details>
        )}
      </div>
      {item.storeId && <code className="text-muted-foreground bg-muted px-1 rounded shrink-0 mt-0.5">loja #{item.storeId}</code>}
    </div>
  );
};
