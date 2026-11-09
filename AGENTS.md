# AGENTS.md

Guía para cualquier agente de IA (Claude, Codex, etc.) que trabaje en este repo.

**Al empezar: leé `MEMORY.md`. Al terminar una tarea: actualizalo** (estado, decisiones nuevas con su porqué).

## Qué es
App personal para administrar webs/apps de clientes: estado de cada proyecto, fechas (cobro mensual, renovación de dominio y hosting) y recibos PDF de cada pago mensual. Se usa en PC y celular, desde cualquier lugar. Un solo usuario (el dueño).

## Stack
- **PWA estática en vanilla JS, sin build.** `index.html`, `app.js`, `logic.js`, `styles.css`, `sw.js`, `manifest.webmanifest`.
- **Supabase**: Postgres + Auth (email/contraseña) + Storage (bucket privado `recibos`). Esquema completo en `supabase/schema.sql`.
- Librerías por CDN con **versión exacta** (nunca `@latest` ni `@2`): supabase-js (jsdelivr ESM) y jsPDF (cdnjs).
- Hosting: GitHub Pages. `config.js` tiene URL y clave `anon` de Supabase (pública por diseño; la seguridad es RLS).

## Correr local
```bash
python -m http.server 8080
```
Abrir http://localhost:8080. Tests de la lógica pura: `node test.mjs`.

## Reglas
- Toda tabla nueva: columna `user_id uuid default auth.uid()` + RLS `user_id = auth.uid()`.
- Los pagos se crean **solo** con `rpc('register_payment')` (numeración atómica de recibos). No hay policy de insert en `payments`.
- Los archivos van en `recibos/<user_id>/...` (la policy de Storage lo exige).
- No borrar proyectos con pagos (FK `restrict`): se marcan `finalizado`.
- UI en español rioplatense (es-AR), mobile-first, montos con `Intl.NumberFormat('es-AR', { style: 'currency', currency })`.
- Lógica sin DOM ni red va en `logic.js` y se prueba en `test.mjs`.
- Al cambiar archivos de la interfaz, subir la versión `CACHE` en `sw.js`.

## Skills
- `ponytail` para código: el cambio mínimo que resuelve todo.
- `impeccable` para UI/diseño. Contexto en `PRODUCT.md`.
