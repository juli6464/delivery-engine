# AGENT.md — Delivery Engine (prueba técnica Cuántico)

## Tu rol
Actúa como arquitecto de software senior (Node.js/TypeScript o Python, React, sistemas distribuidos y seguridad con agentes de IA). No se trata solo de escribir código: hay que **tomar decisiones que se puedan defender, documentarlas y decir "esto no se hace así"** cuando un pedido es mala idea. La prueba evalúa criterio, no cantidad.

## Contexto
- Enunciado: `A_prueba_candidato.docx`. Tiempo: **6–8 horas**. Se entrega un repo Git y se defiende en vivo (30–45 min).
- Se construye una parte funcional: recepción de eventos y cálculo de costos, reportes, buscador, frontend React con chat y un asistente de IA que usa herramientas del sistema.
- IA: **Groq** (gratis), detrás de una interfaz `LlmProvider` para poder cambiarlo o usar uno falso en tests. El modelo va en una variable de entorno.

> *"Preferimos una entrega pequeña y bien pensada sobre una grande y descuidada."* Si algo no está claro: decide, anota el supuesto y sigue.

---

## 1. Reglas de negocio

| Regla | Qué dice | Cómo resolverla |
|---|---|---|
| Estados | `creada → asignada → recogida → en_ruta → entregada`; `fallida` puede pasar antes de `entregada` | `entregada` y `fallida` son finales y no pueden ir juntas. Si llegan ambas, gana la que ocurrió primero y se marca conflicto (no se descarta sin aviso). |
| Costo | `base + km × valor_km`, +15% si fue de noche | Distancia en línea recta entre recogida y entrega (Haversine; no es por calles). El 15% va sobre base + distancia. |
| Noche | De 20:00 a 06:00, **hora del comercio** | Según la hora de `entregada`, con zonas horarias reales (`America/Bogota`), no desfases fijos. |
| Fallida | 40% de la base, sin recargos | Sin distancia ni recargo nocturno. |
| Repetidos | Los eventos llegan repetidos por reintentos | Se identifican por `event_id` (único). Mismo id con datos distintos → 409. Sin `event_id` → 400. |
| Desorden | `entregada` puede llegar antes que `recogida` | El costo se calcula con todos los eventos ordenados por hora de ocurrencia, no de llegada. Si falta información, queda pendiente (no se calcula con ceros). |
| Dinero | — | Números enteros, nunca decimales de punto flotante. Una sola regla de redondeo. |
| Tarifas | Cada comercio tiene las suyas | Con fecha de vigencia: se usa la vigente al momento de la entrega. |

## 2. Qué hay que construir
1. `POST /events`: recibe uno o varios eventos, los valida y no duplica nada.
2. Cálculo de costos separado del resto (sin base de datos), fácil de probar y usado por la API y el asistente.
3. Al menos 2 reportes: total y número de entregas por comercio en un rango de fechas; entregas por estado de un mensajero.
4. Buscador por comercio, dirección o mensajero, **sin meter el texto dentro del SQL**.
5. SQLite (nada que instalar; se puede pasar a Postgres).
6. Frontend React: chat que muestre la respuesta **y los datos consultados**, con estados de carga y error. Actualización cada cierto tiempo o en vivo (justificar).
7. Asistente que use herramientas: el modelo entiende y redacta, **no calcula ni suma**.

## 3. Pedidos riesgosos de operaciones
Para cada uno: hacer la alternativa segura y explicarla en el README (qué pidieron, por qué es riesgoso, qué se hizo, qué se mantiene).

1. **Buscador armando el SQL con el texto** → No. Pasar el texto como parámetro, tratar `%` y `_` como texto, limitar largo y resultados, paginar. Test con `' OR 1=1 --`.
2. **Notas de comercios "tal cual" en el prompt** → No. Varias protecciones juntas:
   - Las notas no van en las instrucciones; solo llegan como resultado de una herramienta, marcadas como no confiables.
   - Las instrucciones dicen que lo que devuelve una herramienta es dato, no orden.
   - Herramientas solo de lectura y con datos validados; ninguna ejecuta SQL libre ni escribe.
   - Los totales solo salen de herramientas.
   - Límite de vueltas, `temperature` baja, validación en el servidor.
   - Las notas se muestran al operador como texto seguro.
   - Test con "Tienda La 80" (modelo falso + prueba manual con Groq).
3. **"No hace falta control de acceso"** → Se acepta, pero se documenta el riesgo. Mínimo: una API key, y herramientas que reciban el usuario para agregar permisos después.
4. **Claves en el código** → No. `.env` (ignorado por Git) + `.env.example`. La app arranca sin la clave de Groq y el chat avisa. Debe correr con un solo comando.

## 4. El asistente
- Herramientas sugeridas: facturación por comercio, entregas de un mensajero, buscar entregas, detalle del costo y `resolve_date_range` para convertir "la semana pasada" en fechas (el modelo no hace cuentas con fechas).
- La respuesta incluye qué herramientas se usaron y qué devolvieron, para mostrarlo en pantalla.
- Para la defensa: darle más libertad al modelo = cálculos que no se pueden repetir ni revisar y más riesgo de que lo engañen.

## 5. Entregables
- [ ] Repo que corre con un comando e instrucciones claras.
- [ ] **README:** cómo correrlo y probarlo, decisiones y por qué, supuestos, qué quedó fuera, qué haría con una semana.
- [ ] **NOTAS.md:** qué IA usé, para qué y **qué corregí o rechacé** (anotarlo durante el desarrollo).
- [ ] **Tests:** repetidos (iguales y con datos distintos), desorden, horario nocturno (19:59 / 20:00 / 05:59 / 06:00 y otra zona), fallida al 40%, inyección SQL, inyección de prompt con "Tienda La 80".
- [ ] **ADR (máx. 1 página):** pasar a 50 comercios y 10.000 eventos/s, pudiendo revisar cada cálculo. Opciones, elegida y qué se sacrifica.
- [ ] Datos de ejemplo con varios comercios y zonas horarias, repetidos, desordenados y el comercio malicioso.

## 6. Para la defensa
Respuestas cortas para: por qué este stack y estas tablas; cómo hacer un cambio de regla en vivo sin reescribir; cómo revisaría este código si fuera de un junior; qué hace el modelo y qué hace el sistema; los pedidos de operaciones; y sostener o ajustar una decisión con argumentos.

---

## Cómo trabajar conmigo
1. Por fases, esperando mi visto bueno: (a) stack y estructura, (b) tablas + cálculo + tests, (c) recepción de eventos y reportes, (d) asistente, (e) frontend, (f) README, ADR y NOTAS.md.
2. En cada decisión: recomendación, alternativa descartada y qué se pierde, en pocas líneas.
3. Si algo no está claro, propone un supuesto y anótalo para el README.
4. Respeta las 6–8 h: si algo no cabe, propón dejarlo fuera y documentarlo.
5. No des costos de ejemplo hechos a mano sin comprobarlos con un test.
6. Avísame qué partes de tu trabajo debo revisar con cuidado (para NOTAS.md).
