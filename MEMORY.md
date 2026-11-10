# MEMORY.md

Bitácora del proyecto. Se actualiza al cerrar cada tarea.

## Decisiones (y por qué)
- **2026-11-09 — PWA + Supabase en la nube.** El dueño la usa en PC y celular desde cualquier lugar, y desde el celu también registra pagos y comparte recibos. Supabase da base, login y archivos gratis sin mantener un servidor.
- **Moneda por proyecto: ARS o USD, sin impuestos.** Pedido del dueño.
- **PDF generado en el navegador (jsPDF)** y guardado en Storage: no hace falta backend propio y funciona igual en el celu.
- **Numeración de recibos con la función SQL `register_payment`**: atómica, así PC y celu no repiten número.
- **Hosting en GitHub Pages**: estático y gratis.
- **Sin build ni framework**: menos piezas que mantener.

- **Estilo visual: "estándar limpio"** (tipo Linear/Notion), elegido por el dueño entre 4 opciones. Claro/oscuro según el sistema; barra de pestañas abajo en el celu.
- **Pagos no se borran ni editan desde la app** (los recibos son correlativos). Si hace falta anular, es una mejora pendiente.

## Estado (2026-11-09)
- Hecho: esquema SQL, interfaz completa (Panel, Proyectos, Recibos, Ajustes, login), PDF del recibo, compartir, PWA instalable, tests de `logic.js` (`node test.mjs`).
- Probado con un backend simulado en el navegador (escritorio y 375px): crear/editar proyecto, registrar pago → PDF, regenerar PDF, filtros, ajustes, bloqueo de borrado con recibos.
- **No probado todavía contra Supabase real** ni en un celular de verdad (Compartir por WhatsApp).
- Pendiente de diseño: revisión final de impeccable y DESIGN.md.

## Publicación
- Repo público: https://github.com/MauricioZarate0/administrador-proyectos (rama `main`).
- GitHub Pages activo desde `main` / raíz: https://mauriciozarate0.github.io/administrador-proyectos/
- `logo-animado/` es una carpeta aparte del dueño: quedó fuera del repo (.gitignore) hasta que confirme si va.

- Supabase conectado (2026-11-09): proyecto `bzfmtrawqzqgsyfrxwjy`, schema cargado, registros cerrados (verificado: signup_disabled). La app publicada muestra el login sin errores.

- 2026-11-09: tipo de proyecto libre (texto con sugerencias) y selector de tema Automático/Claro/Oscuro en Ajustes (guardado en localStorage, por dispositivo).

- 2026-11-09: contrato PDF por proyecto (`recibos/<uid>/contratos/<id>.pdf`), anular recibo (sello ANULADO, el mes vuelve a pendiente, no se deshace), aumento de cuotas (`adjust_fees`; redondeo solo en ARS, USD a centavos) con historial automático por trigger (`fee_changes`), y gastos por proyecto con ganancia en Panel y en el proyecto. Migración `003`.
- **Orden de despliegue con migraciones:** correr el SQL antes de pushear; la app lee las tablas nuevas al cargar y sin ellas no arranca.

- 2026-11-09: ícono opcional por proyecto (96px, data URL en `projects.icon`, migración `004`; sin ícono se muestra la inicial) y cuadro del dólar MEP arriba a la derecha (dolarapi.com `/v1/dolares/bolsa`, se consulta al abrir/iniciar sesión y al tocarlo).

- 2026-11-10: **"Por hacer"** en proyectos (tabla `tasks`, checklist; se muestra si el proyecto está En desarrollo o ya tiene tareas; la lista de proyectos dice cuántas quedan) y **Suscripciones** como pestaña aparte (tabla `subscriptions`: lo que paga el dueño, mensual/anual; "Pagada" corre la fecha un ciclo; aparecen en Renovaciones próximas del Panel). Son tablas aparte y no proyectos porque una suscripción es un costo propio, no un cobro a un cliente. Migración `005`. No se suman a Gastos/Ganancia del Panel (los gastos son por proyecto).

## Pendiente del dueño (manual)
- Migración 005 aplicada y verificada (2026-11-10); tareas y suscripciones publicadas.
- Migraciones 003 y 004 aplicadas y verificadas (2026-11-09); todo publicado (commit 65f82fd). La 002 no se puede verificar con la clave anónima: si guardar un tipo nuevo falla, correrla.
- Primer uso real: login, Ajustes, cargar proyectos, probar un pago y "Compartir" en el celu.
- **Correr `supabase/migrations/002_tipo_libre.sql`** en el SQL Editor (sin esto, guardar un tipo nuevo falla).
- Primer login real, completar Ajustes, cargar proyectos, probar un pago y "Compartir" en el celu.

## Problemas conocidos
- Supabase gratis pausa tras 7 días sin uso (se restaura a mano).
