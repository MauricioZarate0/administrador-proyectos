# AGENTS.md

Guía para cualquier agente de IA (Claude, Codex, etc.) que trabaje en este repo.

**Al empezar: leé `MEMORY.md`. Al terminar una tarea: actualizalo** (estado, decisiones nuevas con su porqué).

## Qué es
App personal para administrar webs/apps de clientes: estado de cada proyecto, fechas (cobro mensual, renovación de dominio y hosting) y recibos PDF de cada pago mensual. Se usa en PC y celular, desde cualquier lugar. Un solo usuario (el dueño).

## Stack (todo en Cloudflare)
- **`public/`: PWA estática en vanilla JS, sin build.** `index.html`, `app.js`, `api.js`, `logic.js`, `styles.css`, `sw.js`, `manifest.webmanifest`. Es lo único que se publica.
- **`functions/api/[[path]].js`: Pages Function** con la API (`/api/me`, `/api/db`, `/api/rpc/*`, `/api/files/*`). `public/_routes.json` hace que solo `/api/*` invoque la función.
- **D1** (binding `DB`, SQLite) para los datos: esquema completo en `d1/schema.sql`. **R2** (binding `FILES`) para PDF y logo.
- **Login: Cloudflare Access** (código por mail, solo el email del dueño, sesión de 1 mes). No hay contraseñas en la app.
- `wrangler.toml` manda sobre los bindings y vars (no se editan en el dashboard). `main` = producción; las otras ramas son previews con base y bucket `-prueba`. `OWNER_EMAIL` es un secret (`npx wrangler pages secret put OWNER_EMAIL [--env preview]`), no va al repo.
- Cada push a `main` se publica solo en https://administrador-proyectos.pages.dev.
- jsPDF por CDN con **versión exacta** (cdnjs).

## Correr local
```bash
npx wrangler pages dev --port 8788
```
Necesita `.dev.vars` (no se sube) con `DEV_EMAIL=dev@localhost` y `OWNER_ID=u1`: en localhost reemplaza a Access. Base local: `npx wrangler d1 execute administrador-proyectos --local --file d1/schema.sql`. Tests de la lógica pura: `node test.mjs`.

## Reglas
- **Seguridad:** la API valida el JWT de Access (firma, `iss`, `aud`, vencimiento y que el email sea `OWNER_EMAIL`) en CADA pedido y falla cerrada si falta configuración. Nunca agregar rutas que se salteen `authorize()`.
- La API genérica `/api/db` solo acepta las tablas de `TABLES` y columnas que existen (PRAGMA); update/delete exigen filtro. Una tabla nueva se suma ahí, en `d1/schema.sql` y como `d1/migrations/NNN_nombre.sql` para la base existente (correrla en prueba y producción **antes** de publicar).
- Los pagos se crean **solo** con `rpc('register_payment')` (batch de D1 = transacción: numeración de recibos sin repetidos). `fee_changes` lo llena un trigger.
- Archivos en R2 bajo `<OWNER_ID>/...` (OWNER_ID es el uid que tenía en Supabase, así las rutas viejas siguen valiendo).
- No borrar proyectos con pagos o gastos (FK `RESTRICT` → error con code `23503`): se marcan `finalizado`.
- `/api` y `/cdn-cgi` nunca se cachean en `sw.js`. Al cambiar archivos de `public/`, subir la versión `CACHE` en `sw.js`.
- UI en español rioplatense (es-AR), mobile-first, montos con `Intl.NumberFormat('es-AR', { style: 'currency', currency })`.
- Lógica sin DOM ni red va en `public/logic.js` y se prueba en `test.mjs`.
- Respaldos (`respaldo-*.json`) y `migracion/` tienen datos de clientes: nunca al repo (está en `.gitignore`).

## Skills
- `ponytail` para código: el cambio mínimo que resuelve todo.
- `impeccable` para UI/diseño. Contexto en `PRODUCT.md`.
