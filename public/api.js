// Cliente de la API propia (/api) con la misma forma que la parte de supabase-js que usa app.js,
// así app.js casi no cambia. Todo pedido devuelve { data, error } como supabase-js.

// Si la sesión de Cloudflare Access venció, el fetch termina en un redirect a otro dominio y falla:
// en ese caso se recarga la página entera para que Access pida el código de nuevo.
async function call(url, init) {
  let r;
  try {
    r = await fetch(url, { credentials: 'same-origin', redirect: 'manual', ...init });
  } catch (e) {
    return { data: null, error: { message: 'fetch: ' + e.message } };
  }
  if (r.type === 'opaqueredirect' || r.status === 401) {
    location.reload();
    return new Promise(() => {}); // la recarga corta todo
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    return { data: null, error: body.error ?? { message: `Error ${r.status}` } };
  }
  return { data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.blob(), error: null };
}

const post = (url, body) => call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

class Query {
  constructor(table) { this.q = { table, op: 'select', filters: [] }; }
  select() { return this; }
  order(col, o) { this.q.order = [col, o?.ascending !== false]; return this; }
  range(a, b) { this.q.range = [a, b]; return this; }
  eq(col, val) { this.q.filters.push([col, val]); return this; }
  insert(row) { Object.assign(this.q, { op: 'insert', row }); return this; }
  update(row) { Object.assign(this.q, { op: 'update', row }); return this; }
  delete() { this.q.op = 'delete'; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(ok, ko) {
    return post('/api/db', this.q)
      .then((r) => (r.error || !this.one ? r : { data: r.data[0] ?? null, error: null }))
      .then(ok, ko);
  }
}

const filePath = (p) => '/api/files/' + p.split('/').map(encodeURIComponent).join('/');

export function createClient() {
  return {
    auth: {
      // Access ya autenticó al cargar la página: se avisa una vez con el usuario.
      onAuthStateChange(cb) {
        call('/api/me').then(({ data, error }) => cb(error ? 'SIGNED_OUT' : 'INITIAL_SESSION', error ? null : { user: data }));
      },
      async signOut() { location.href = '/cdn-cgi/access/logout'; return { error: null }; },
    },
    from: (table) => new Query(table),
    rpc: (name, args) => post(`/api/rpc/${name}`, args),
    storage: {
      from: () => ({
        upload: (path, body, opts) => call(filePath(path), { method: 'PUT', headers: { 'content-type': opts?.contentType ?? body.type ?? 'application/octet-stream' }, body }),
        download: (path) => call(filePath(path)),
        remove: (paths) => Promise.all(paths.map((p) => call(filePath(p), { method: 'DELETE' }))).then((rs) => rs.find((r) => r.error) ?? { data: [], error: null }),
      }),
    },
  };
}
