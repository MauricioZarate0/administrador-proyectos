// Carga un respaldo de "Exportar todo" (Ajustes) en D1 y R2, y verifica que quedó igual.
//
//   node scripts/importar-respaldo.mjs <respaldo.json> --db <base> --bucket <bucket> [--remote | --local] [--preview]
//
// La base tiene que estar recién creada con d1/schema.sql (no borra nada: si hay datos, falla por ids repetidos).
// Deja los archivos intermedios en migracion/ (ignorada por git: tiene datos de clientes).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const file = args[0];
const DB = opt('--db'), BUCKET = opt('--bucket');
const where = args.includes('--remote') ? '--remote' : '--local';
const envArgs = args.includes('--preview') ? ['--env', 'preview'] : [];
if (!file || !DB || !BUCKET) { console.error('Uso: node scripts/importar-respaldo.mjs <respaldo.json> --db <base> --bucket <bucket> [--remote|--local] [--preview]'); process.exit(1); }

const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
if (backup.app !== 'administrador-proyectos' || backup.version !== 1) throw new Error('No es un respaldo de esta app');
const T = backup.tables;

// Orden por claves foráneas. user_id solo existe en settings (un solo dueño).
const ORDER = ['settings', 'projects', 'payments', 'expenses', 'fee_changes', 'tasks', 'subscriptions'];
const INSTANT = new Set(['created_at', 'changed_at', 'voided_at']);
const lit = (v) => v === null || v === undefined ? 'NULL'
  : typeof v === 'boolean' ? (v ? '1' : '0')
  : typeof v === 'number' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;
const conv = (table, k, v) => {
  if (v === null || v === undefined) return null;
  if (table === 'settings' && k === 'quick_links') return JSON.stringify(v);
  if (INSTANT.has(k)) return new Date(v).toISOString(); // Postgres '...+00:00' → ISO con Z, como los defaults de D1
  if (['fee', 'amount', 'old_fee', 'new_fee'].includes(k)) return Number(v);
  return v;
};

const out = 'migracion';
fs.mkdirSync(path.join(out, 'files'), { recursive: true });
const sql = [];
for (const t of ORDER) {
  for (const row of T[t] ?? []) {
    const r = Object.fromEntries(Object.entries(row).filter(([k]) => t === 'settings' || k !== 'user_id').map(([k, v]) => [k, conv(t, k, v)]));
    sql.push(`INSERT INTO "${t}" (${Object.keys(r).map((k) => `"${k}"`).join(', ')}) VALUES (${Object.values(r).map(lit).join(', ')});`);
  }
}
fs.writeFileSync(path.join(out, 'data.sql'), sql.join('\n') + '\n');

const wrangler = (...a) => execFileSync('npx', ['wrangler', ...a, ...envArgs], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'inherit'] });
const query = (s) => JSON.parse(wrangler('d1', 'execute', DB, where, '--json', '--command', JSON.stringify(s)))[0].results;

console.log(`Datos: ${sql.length} filas → ${DB} (${where})`);
wrangler('d1', 'execute', DB, where, '--file', path.join(out, 'data.sql'), '-y');

const paths = Object.keys(backup.files);
console.log(`Archivos: ${paths.length} → ${BUCKET}`);
for (const p of paths) {
  const f = backup.files[p];
  const local = path.join(out, 'files', ...p.split('/'));
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, Buffer.from(f.base64, 'base64'));
  if (fs.statSync(local).size !== f.size) throw new Error(`Tamaño distinto en ${p}`);
  wrangler('r2', 'object', 'put', `${BUCKET}/${p}`, '--file', JSON.stringify(local), '--content-type', f.type || 'application/octet-stream', where);
}

// ---------- Verificación ----------
let ok = true;
const check = (label, a, b) => { const same = JSON.stringify(a) === JSON.stringify(b); ok &&= same; console.log(`${same ? 'OK ' : 'MAL'} ${label}: respaldo ${JSON.stringify(a)} · D1 ${JSON.stringify(b)}`); };
for (const t of ORDER) check(`filas ${t}`, (T[t] ?? []).length, query(`SELECT count(*) AS n FROM "${t}"`)[0].n);
const sums = (rows) => Object.fromEntries(Object.entries(rows.reduce((a, x) => ((a[x.currency] = (a[x.currency] ?? 0) + Number(x.amount)), a), {})).map(([c, n]) => [c, Math.round(n * 100) / 100]).sort());
check('total pagos por moneda', sums(T.payments), Object.fromEntries(query('SELECT currency, round(sum(amount), 2) AS s FROM payments GROUP BY currency ORDER BY currency').map((x) => [x.currency, x.s])));
check('próximo recibo', T.settings[0]?.next_receipt, query('SELECT next_receipt FROM settings')[0]?.next_receipt);
for (const p of paths) {
  const tmp = path.join(out, 'verif.bin');
  wrangler('r2', 'object', 'get', `${BUCKET}/${p}`, '--file', JSON.stringify(tmp), where);
  check(`archivo ${p}`, backup.files[p].size, fs.statSync(tmp).size);
}
fs.rmSync(path.join(out, 'verif.bin'), { force: true });
console.log(ok ? '\nTodo coincide.' : '\nHAY DIFERENCIAS: revisar antes de usar la base.');
process.exit(ok ? 0 : 1);
