// API de la app sobre D1 (datos) y R2 (PDF y logo). Reemplaza a Supabase.
// Seguridad: Cloudflare Access protege el sitio y acá se valida su JWT en CADA pedido (reemplaza al RLS).
// Si falta configuración, todo responde 500: nunca queda abierto.
//
// Rutas:  GET /api/me · POST /api/db · POST /api/rpc/<nombre> · GET|PUT|DELETE /api/files/<ruta>

const TABLES = {
  settings: { json: ['quick_links'], noDelete: true },
  projects: {},
  payments: { noInsert: true }, // solo con rpc register_payment (numeración atómica)
  expenses: {},
  fee_changes: { readOnly: true }, // lo llena el trigger
  tasks: { bool: ['done'] },
  subscriptions: {},
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, message, code) => json({ error: { message, code } }, status);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export async function onRequest({ request, env, params }) {
  try {
    const email = await authorize(request, env);
    const [head, ...rest] = params.path ?? [];
    const method = request.method;
    if (head === 'me' && method === 'GET') return json({ id: env.OWNER_ID, email });
    if (head === 'db' && method === 'POST') return json(await db(env, await request.json()));
    if (head === 'rpc' && method === 'POST') return json(await rpc(env, rest[0], await request.json()));
    if (head === 'files') return files(env, method, rest.join('/'), request);
    return fail(404, 'No existe');
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message);
    const msg = String(e?.message ?? e);
    if (/FOREIGN KEY constraint failed/i.test(msg)) return fail(409, msg, '23503'); // mismo código que usaba Postgres
    if (/constraint failed/i.test(msg)) return fail(400, msg, 'constraint');
    return fail(500, msg);
  }
}

// ---------- Acceso ----------

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const decode = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));
let certs = { keys: [], at: 0 };

async function authorize(request, env) {
  const host = new URL(request.url).hostname;
  // Solo para `wrangler pages dev`: DEV_EMAIL vive en .dev.vars (no se sube) y el host de producción nunca es localhost.
  if (env.DEV_EMAIL && (host === 'localhost' || host === '127.0.0.1')) return env.DEV_EMAIL;

  const { TEAM_DOMAIN, POLICY_AUD, OWNER_EMAIL } = env;
  if (!TEAM_DOMAIN || !POLICY_AUD || !OWNER_EMAIL || !env.OWNER_ID) throw new HttpError(500, 'Falta configurar el acceso (TEAM_DOMAIN, POLICY_AUD, OWNER_EMAIL, OWNER_ID).');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new HttpError(401, 'No autenticado');

  const [h, p, sig] = token.split('.');
  let header, payload;
  try { header = decode(h); payload = decode(p); } catch { throw new HttpError(401, 'Token inválido'); }
  if (header.alg !== 'RS256' || !sig) throw new HttpError(401, 'Token inválido');

  const jwk = await certFor(TEAM_DOMAIN, header.kid);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
  const aud = [].concat(payload.aud ?? []);
  const now = Date.now() / 1000;
  if (!valid || payload.iss !== TEAM_DOMAIN || !aud.includes(POLICY_AUD) || !(payload.exp > now) || (payload.nbf && payload.nbf > now + 60)) {
    throw new HttpError(401, 'Token inválido');
  }
  if (String(payload.email ?? '').toLowerCase() !== OWNER_EMAIL.toLowerCase()) throw new HttpError(403, 'Sin permiso');
  return payload.email;
}

// Las claves rotan: se cachean 1 h y se vuelven a pedir si aparece un kid desconocido.
async function certFor(team, kid) {
  for (const fresh of [false, true]) {
    if (fresh || Date.now() - certs.at > 3600e3) {
      const r = await fetch(`${team}/cdn-cgi/access/certs`);
      if (!r.ok) throw new HttpError(503, 'No se pudieron validar las credenciales');
      certs = { keys: (await r.json()).keys ?? [], at: Date.now() };
    }
    const k = certs.keys.find((x) => x.kid === kid);
    if (k) return k;
  }
  throw new HttpError(401, 'Token inválido');
}

// ---------- Datos ----------

const columnsCache = {};
async function columns(env, table) {
  return (columnsCache[table] ??= new Set((await env.DB.prepare(`PRAGMA table_info("${table}")`).all()).results.map((c) => c.name)));
}

const toDb = (t, row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k,
  TABLES[t].json?.includes(k) ? JSON.stringify(v ?? []) : TABLES[t].bool?.includes(k) ? (v ? 1 : 0) : v === undefined ? null : v]));
const fromDb = (t, rows) => rows.map((r) => {
  for (const k of TABLES[t].json ?? []) r[k] = JSON.parse(r[k] ?? '[]');
  for (const k of TABLES[t].bool ?? []) r[k] = !!r[k];
  return r;
});

async function db(env, { table, op, filters = [], order, range, row = {} }) {
  const spec = TABLES[table];
  if (!spec) throw new HttpError(400, 'Tabla desconocida');
  const cols = await columns(env, table);
  const col = (c) => { if (!cols.has(c)) throw new HttpError(400, `Columna desconocida: ${c}`); return `"${c}"`; };
  const where = filters.length ? ` WHERE ${filters.map(([c]) => `${col(c)} = ?`).join(' AND ')}` : '';
  const fvals = filters.map(([, v]) => v);
  let stmt;

  if (op === 'select') {
    let sql = `SELECT * FROM "${table}"${where}`;
    if (order) sql += ` ORDER BY ${col(order[0])} ${order[1] === false ? 'DESC' : 'ASC'}`;
    const vals = [...fvals];
    if (range) { sql += ' LIMIT ? OFFSET ?'; vals.push(range[1] - range[0] + 1, range[0]); }
    stmt = env.DB.prepare(sql).bind(...vals);
  } else {
    if (spec.readOnly) throw new HttpError(403, 'Tabla de solo lectura');
    if (op === 'insert') {
      if (spec.noInsert) throw new HttpError(403, 'Los pagos se crean con register_payment');
      const r = toDb(table, table === 'settings' ? { ...row, user_id: env.OWNER_ID } : row);
      const keys = Object.keys(r);
      stmt = keys.length
        ? env.DB.prepare(`INSERT INTO "${table}" (${keys.map(col).join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`).bind(...Object.values(r))
        : env.DB.prepare(`INSERT INTO "${table}" DEFAULT VALUES RETURNING *`);
    } else if (op === 'update' || op === 'delete') {
      if (!filters.length) throw new HttpError(400, 'Falta el filtro'); // nunca tocar toda la tabla
      if (op === 'delete') {
        if (spec.noDelete) throw new HttpError(403, 'No se puede borrar');
        stmt = env.DB.prepare(`DELETE FROM "${table}"${where} RETURNING *`).bind(...fvals);
      } else {
        const r = toDb(table, row);
        delete r.id; delete r.user_id;
        const keys = Object.keys(r);
        if (!keys.length) throw new HttpError(400, 'Nada para actualizar');
        stmt = env.DB.prepare(`UPDATE "${table}" SET ${keys.map((k) => `${col(k)} = ?`).join(', ')}${where} RETURNING *`).bind(...Object.values(r), ...fvals);
      }
    } else throw new HttpError(400, 'Operación desconocida');
  }
  return fromDb(table, (await stmt.all()).results);
}

async function rpc(env, name, a) {
  if (name === 'register_payment') {
    // Un batch de D1 es una transacción: se inserta con el número actual y se incrementa, o nada.
    const [ins] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO payments (project_id, paid_on, period, amount, currency, receipt_no, note)
        SELECT p.id, ?2, ?3, ?4, ?5, s.next_receipt, ?6 FROM projects p, settings s WHERE p.id = ?1 RETURNING *`)
        .bind(a.p_project, a.p_paid_on, a.p_period, a.p_amount, a.p_currency, a.p_note ?? ''),
      env.DB.prepare('UPDATE settings SET next_receipt = next_receipt + 1 WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?1)').bind(a.p_project),
    ]);
    if (!ins.results.length) throw new HttpError(400, 'Proyecto inexistente');
    return ins.results[0];
  }
  if (name === 'adjust_fees') {
    const r = Number(a.p_round) || 0.01;
    const { results } = await env.DB.prepare(`UPDATE projects SET fee = round(round(fee * (1 + ?1 / 100.0) / ?2) * ?2, 2)
      WHERE fee > 0 AND id IN (SELECT value FROM json_each(?3)) RETURNING *`)
      .bind(Number(a.p_percent), r, JSON.stringify(a.p_projects ?? [])).all();
    return results;
  }
  throw new HttpError(404, 'Función desconocida');
}

// ---------- Archivos (R2) ----------

async function files(env, method, key, request) {
  if (!key || key.length > 512 || key.split('/').some((s) => !s || s === '.' || s === '..')) throw new HttpError(400, 'Ruta inválida');
  if (method === 'GET') {
    const obj = await env.FILES.get(key);
    if (!obj) return fail(404, 'Object not found');
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'no-store' } });
  }
  if (method === 'PUT') {
    if (Number(request.headers.get('content-length') ?? 0) > 11e6) throw new HttpError(413, 'Archivo demasiado grande');
    const type = request.headers.get('content-type') ?? 'application/octet-stream';
    const body = await request.arrayBuffer();
    if (body.byteLength > 11e6) throw new HttpError(413, 'Archivo demasiado grande');
    await env.FILES.put(key, body, { httpMetadata: { contentType: type } });
    return json({ path: key });
  }
  if (method === 'DELETE') { await env.FILES.delete(key); return json([]); }
  return fail(405, 'Método no permitido');
}
