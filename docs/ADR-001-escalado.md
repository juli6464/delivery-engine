# ADR-001 — Cómo pasar a 10.000 eventos por segundo sin perder el rastro de cada costo

**Estado:** propuesto · **Fecha:** 2026-10-29

> Un ADR es un documento corto que registra una decisión de arquitectura: qué opciones había, cuál se eligió y qué se sacrifica.

## Situación
Hoy hay 5 comercios y cientos de eventos por segundo. Cada evento se guarda en SQLite y el costo se recalcula en ese mismo momento. El escenario nuevo es **50 comercios y 10.000 eventos por segundo** (unos 860 millones al día), y operaciones quiere poder **revisar cómo se calculó cada costo**. Los eventos seguirán llegando repetidos y desordenados. El equipo conoce Postgres, pero no tiene experiencia con sistemas de mensajería como Kafka.

## Opciones
1. **Postgres, igual que hoy.** Es el cambio más pequeño, pero cada evento espera a que se recalcule su costo. En los picos, la base se satura y todo se pone lento.
2. **Postgres para guardar y también como lista de tareas (elegida).** Al llegar un evento solo se guarda y se anota "esta entrega hay que recalcularla". Unos procesos aparte (workers) hacen los cálculos.
3. **Kafka o AWS SQS + procesos aparte.** Es lo habitual a gran escala, pero el equipo no lo conoce: cuesta operarlo y es fácil configurarlo mal.

## Decisión: opción 2
- **Al recibir eventos:** se guardan por lotes. Si el `event_id` ya existe, se ignora. La entrega se anota en una tabla `pending_deliveries` (si ya estaba anotada, no se duplica). Se responde **202** ("recibido, se procesará"). Diez eventos de la misma entrega generan **un solo** recálculo.
- **Workers:** toman entregas pendientes de a 100. Postgres (`FOR UPDATE SKIP LOCKED`) asegura que **dos workers nunca tomen la misma entrega a la vez**. Si llega un evento nuevo mientras se calcula, la entrega vuelve a quedar pendiente y se recalcula. No hay riesgo: con los mismos eventos el cálculo siempre da lo mismo.
- **Repetidos y desorden:** se resuelven igual que hoy, recalculando desde todos los eventos. **Las reglas de cálculo no cambian**, y por eso se mantuvieron separadas del resto.
- **Revisión de costos:** cada cálculo agrega una fila que nunca se modifica en `cost_calculations`, con la versión del código, la tarifa, los eventos usados y el detalle. Cualquier costo se puede **repetir** corriendo ese mismo código con esos mismos datos.
- **Reportes:** se mantienen totales por comercio y día, que se actualizan con cada cálculo. Los reportes y el asistente leen de una **copia de la base**, para no frenar las escrituras. Las herramientas del asistente no cambian.
- **Mantenimiento:** un administrador de conexiones (PgBouncer), limpieza frecuente de la tabla de pendientes y las tablas grandes divididas por mes, archivando lo viejo.

## Lo que se sacrifica
- **Todo depende de Postgres:** si falla, falla todo. Se mitiga con un servicio administrado con copia de respaldo y cambio automático (RDS o Cloud SQL).
- **Tiene un límite.** Aguanta 10.000 eventos por segundo, pero con poco margen. **Cuándo cambiar:** si las entregas esperan más de 30 s en la lista de pendientes, o el procesador de la base pasa del 70% de forma sostenida, se pasa a la opción 3. El cambio es acotado: los workers solo cambian de dónde leen la entrega a recalcular.
- **El costo no aparece al instante:** tarda unos segundos. Para operaciones está bien ("casi tiempo real"), y la demora se vigila con una alerta.
- **Más espacio en disco** por guardar cada cálculo. Es el precio de poder revisarlos.

## Qué cambia
Cambian la recepción de eventos (responde 202 y deja la tarea anotada) y la base de datos (Postgres en vez de SQLite). No cambian las reglas de negocio, sus tests ni las herramientas del asistente. El equipo trabaja con una sola tecnología que ya conoce, y queda claro cuándo conviene pasar a Kafka.
