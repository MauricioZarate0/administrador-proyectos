# Administrador de proyectos

App para llevar tus webs y apps: estado, fechas de cobro y renovaciones, y recibos PDF de cada pago mensual. Funciona en la PC y en el celular (se instala como app).

## Puesta en marcha (una sola vez, ~15 min)

### 1. Supabase (base de datos y archivos, gratis)
1. Creá una cuenta en https://supabase.com y un proyecto nuevo (región: São Paulo).
2. **SQL Editor** → New query → pegá todo `supabase/schema.sql` → **Run**.
3. **Authentication → Users → Add user → Create new user**: tu email y una contraseña. Marcá *Auto Confirm User*.
4. **Authentication → Sign In / Providers**: desactivá **Allow new users to sign up** (así nadie más puede crearse cuenta).
5. **Project Settings → API**: copiá *Project URL* y la clave *anon public* en `config.js`.

### 2. Probar en la PC
```bash
python -m http.server 8080
```
Abrí http://localhost:8080 e ingresá con tu email y contraseña. Primero completá **Ajustes** (tus datos para los recibos).

### 3. Publicar (Cloudflare Pages, gratis)
1. Subí esta carpeta a un repo de GitHub.
2. Cloudflare → **Workers & Pages → Create → Pages → Import an existing Git repository** → elegí el repo.
3. Framework preset *None*, sin build command, output `/`, rama `main` → **Save and Deploy**.
4. Queda en `https://<proyecto>.pages.dev` y cada push a `main` se publica solo.

### 4. Instalar en el celular
- **Android (Chrome)**: abrí la URL → menú ⋮ → *Instalar app*.
- **iPhone (Safari)**: abrí la URL → Compartir → *Agregar a inicio*.
- **PC (Chrome/Edge)**: ícono de instalar en la barra de direcciones.

## A tener en cuenta
- **Supabase gratis pausa el proyecto si pasa 7 días sin uso.** No se pierden datos: entrás a supabase.com y tocás *Restore*. Si te molesta, se puede agregar un ping semanal con GitHub Actions.
- Sin internet la app abre pero no carga datos.
- Un proyecto que ya tiene recibos no se puede borrar: marcalo como *Finalizado*.
