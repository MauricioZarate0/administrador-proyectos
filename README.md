# Administrador de proyectos

App para llevar tus webs y apps: estado, fechas de cobro y renovaciones, y recibos PDF de cada pago mensual. Funciona en la PC y en el celular (se instala como app). Todo corre en Cloudflare (Pages + D1 + R2 + Access), gratis.

## Puesta en marcha (instalación nueva)
1. Cloudflare → **Workers & Pages → Create → Pages → Import an existing Git repository** → elegí el repo. Sin build command, rama `main` (el resto lo toma de `wrangler.toml`).
2. Crear base y bucket, y cargar el esquema:
   ```bash
   npx wrangler d1 create administrador-proyectos
   npx wrangler r2 bucket create administrador-proyectos
   npx wrangler d1 execute administrador-proyectos --remote --file d1/schema.sql
   ```
   Poner el `database_id` en `wrangler.toml` (lo mismo con `-prueba` para las previews).
3. **Zero Trust** (plan Free) → en el proyecto de Pages, *Restrict previews*; después en Zero Trust → Access → Applications, editar esa app y borrar el `*` del subdominio (queda protegiendo la dirección principal) y volver a *Restrict previews* para las previews. Regla: solo tu email. Sesión: 1 mes.
4. En `wrangler.toml` completar `TEAM_DOMAIN`, `POLICY_AUD` (el AUD de cada app de Access) y `OWNER_ID`. Tu email va como secret:
   ```bash
   npx wrangler pages secret put OWNER_EMAIL --project-name administrador-proyectos
   ```
5. Push a `main` y abrir `https://<proyecto>.pages.dev`: Access te pide un código por mail.

## Respaldo y mudanza
- **Ajustes → Exportar todo** baja un JSON con todos los datos y los PDF.
- Para cargarlo en una base nueva (recién creada con el esquema):
  ```bash
  node scripts/importar-respaldo.mjs respaldo.json --db administrador-proyectos --bucket administrador-proyectos --remote
  ```
  Verifica filas, totales, número de recibo y archivos.

## Instalar en el celular
- **Android (Chrome/Brave)**: abrí la URL → menú ⋮ → *Instalar app*.
- **iPhone (Safari)**: abrí la URL → Compartir → *Agregar a inicio*.
- **PC (Chrome/Edge)**: ícono de instalar en la barra de direcciones.

## A tener en cuenta
- Cada mes Access vuelve a pedir el código por mail.
- Sin internet la app abre pero no carga datos.
- Un proyecto que ya tiene recibos no se puede borrar: marcalo como *Finalizado*.
- `supabase/` es la versión anterior (Supabase), guardada como referencia.
