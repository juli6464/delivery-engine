import type { ToolTrace } from '../api/types';

const LABELS: Record<string, string> = {
  list_merchants: 'Lista de comercios',
  list_couriers: 'Lista de mensajeros',
  resolve_date_range: 'Rango de fechas',
  get_merchant_billing: 'Facturación por comercio',
  get_courier_deliveries_by_status: 'Entregas por mensajero',
  search_deliveries: 'Búsqueda de entregas',
  get_delivery_detail: 'Detalle de entrega',
  get_merchant_profile: 'Perfil del comercio',
};

/** Muestra qué consultó el agente y qué datos recibió: la respuesta es verificable por el usuario. */
export function ToolCalls({ calls }: { calls: ToolTrace[] }) {
  if (calls.length === 0) return null;
  return (
    <details className="tool-calls">
      <summary>
        Datos consultados ({calls.length} {calls.length === 1 ? 'consulta' : 'consultas'})
      </summary>
      <ol>
        {calls.map((c, i) => (
          <li key={i} className={c.error ? 'tool-error' : undefined}>
            <div className="tool-head">
              <strong>{LABELS[c.name] ?? c.name}</strong>
              <code>{JSON.stringify(c.arguments)}</code>
              <span className="muted">{c.duration_ms} ms</span>
            </div>
            {/* Texto plano en <pre>: React escapa todo; nunca se interpreta HTML de los datos. */}
            <pre>{c.error ? `Error: ${c.error}` : JSON.stringify(c.result, null, 2)}</pre>
          </li>
        ))}
      </ol>
    </details>
  );
}
