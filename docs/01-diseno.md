# Notas de diseño
> Este fue el plan de la primera fase. **La versión vigente es el [README](../README.md)**. Aquí solo queda lo que no está allá o lo que cambió respecto al plan.

## Qué cambió respecto al plan

| Plan inicial | Cómo quedó | Por qué |
|---|---|---|
| Paquete `packages/shared` con tipos compartidos entre API y frontend | Los tipos se copian en `apps/web/src/api/types.ts` | El frontend solo usa 2 rutas (`/chat` y `/reports/billing`); un paquete aparte complicaba la configuración. |
| Carpeta `routes/` con un archivo por ruta | Un solo `routes.ts` | Son pocas rutas. |
| `MockLlmProvider` para tests | Se llama `ScriptedLlm` | Solo cambió el nombre. |
| Modelo `llama-3.3-70b-versatile` | `openai/gpt-oss-120b` (configurable con `GROQ_MODEL`) | Groq retiró el modelo previsto. |
| Comando `npm run seed && npm run dev` | `npm run setup && npm run dev` | `setup` además crea el `.env`. |

## Detalles que no están en el README

**Tecnologías de apoyo**
- **Vitest** para tests (en vez de Jest): sirve igual para backend y frontend y funciona con TypeScript sin configurar nada.
- **Vite** en vez de Next.js: solo se necesita una página; Next trae funciones que aquí no se usan.

**Por qué se exige `event_id` en vez de inventarlo**
Si falta, se rechaza (400). Se podría generar a partir del contenido del evento, pero dos eventos reales distintos podrían terminar con el mismo id y uno se perdería sin aviso.

**Redondeo**
Se redondea al peso más cercano (0,5 hacia arriba) en cada parte del cálculo, siempre con la misma función de `money.ts`.

**Distancia**
Fórmula de Haversine: distancia en línea recta sobre la Tierra (radio 6.371 km).

**Índices de la base** (para que las consultas sean rápidas)
`events(delivery_id)`, `deliveries(merchant_id, completed_at)`, `deliveries(courier_id, status)`.

**Frontend**
- La API key nunca llega al navegador: el proxy de Vite la agrega del lado del servidor. En producción esto lo haría un servidor intermedio con inicio de sesión.
- El servidor no guarda el historial del chat: el navegador envía los últimos 20 mensajes, solo los textos del usuario y del asistente.
- El texto del modelo se muestra como texto simple (hay un test con una imagen maliciosa en HTML).
- Cada respuesta muestra "Datos consultados": qué herramientas usó, con qué datos y qué devolvieron.

## Puntos para revisar con cuidado
- La lista de modelos de Groq cambia: revisar en console.groq.com antes de entregar.
- "Estado más avanzado y no el último por hora": se puede defender, pero pueden discutirlo.
- El 15% nocturno se aplica sobre base + distancia y según la hora de `entregada`. Es un supuesto: el enunciado solo dice "si la entrega se completó" de noche.
