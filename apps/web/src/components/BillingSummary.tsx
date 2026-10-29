import { useCallback } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { formatCop, minusDays, todayIn } from '../format';

const REFRESH_MS = 10_000;
const DAYS = 7;
const OPS_TIMEZONE = 'America/Bogota';

/** Resumen de facturación de los últimos 7 días, actualizado cada 10 s. */
export function BillingSummary() {
  const to = todayIn(OPS_TIMEZONE);
  const from = minusDays(to, DAYS - 1);
  const fetcher = useCallback((signal: AbortSignal) => api.billing(from, to, signal), [from, to]);
  const { data, error, loading, updatedAt, refresh } = usePolling(fetcher, REFRESH_MS);

  return (
    <section className="panel" aria-labelledby="billing-title">
      <header className="panel-header">
        <h2 id="billing-title">Facturación últimos {DAYS} días</h2>
        <button type="button" className="link" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>
      <p className="muted small">
        {from} a {to}, por fecha local de cada comercio
        {updatedAt && ` · actualizado ${updatedAt.toLocaleTimeString('es-CO')}`}
      </p>

      {error && (
        <p className="error" role="alert">
          No se pudo actualizar: {error}
        </p>
      )}
      {!data && loading && <p className="status">Cargando…</p>}

      {data && (
        <table>
          <thead>
            <tr>
              <th scope="col">Comercio</th>
              <th scope="col" className="num">Entregas</th>
              <th scope="col" className="num">Fallidas</th>
              <th scope="col" className="num">Facturado</th>
              <th scope="col" className="num" title="Pendientes de datos o en conflicto: no se suman al total">
                Por revisar
              </th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((b) => (
              <tr key={b.merchant_id}>
                <th scope="row">
                  {b.merchant_name}
                  {b.timezone !== OPS_TIMEZONE && <span className="tag">{b.timezone}</span>}
                </th>
                <td className="num">{b.deliveries}</td>
                <td className="num">{b.failed}</td>
                <td className="num">{formatCop(b.total_cop)}</td>
                <td className="num">{b.pending + b.conflicts > 0 ? <span className="tag warn">{b.pending + b.conflicts}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
