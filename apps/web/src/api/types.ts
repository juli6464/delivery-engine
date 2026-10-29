// Contratos de la API que consume la UI (espejo de apps/api; ver README sobre por qué no hay paquete compartido).

export type Role = 'user' | 'assistant';

export interface ToolTrace {
  name: string;
  arguments: unknown;
  result?: unknown;
  error?: string;
  duration_ms: number;
}

export interface ChatResponse {
  answer: string;
  tool_calls: ToolTrace[];
  warnings: string[];
}

export interface MerchantBilling {
  merchant_id: string;
  merchant_name: string;
  timezone: string;
  from: string;
  to: string;
  deliveries: number;
  delivered: number;
  failed: number;
  total_cop: number;
  pending: number;
  conflicts: number;
  conflict_cop: number;
}
