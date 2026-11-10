import { createClient } from 'supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as L from './logic.js';

const view = document.getElementById('view');
const topBar = document.querySelector('.top');
const S = { user: null, settings: null, projects: [], payments: [], expenses: [], feeChanges: [], tasks: [], subscriptions: [], filter: { project: '', month: '' } };
const pdfCache = new Map(); // payment id -> Blob, para que "Compartir" no espere la red

const STATUS = { activo: 'Activo', desarrollo: 'En desarrollo', pausado: 'Pausado', finalizado: 'Finalizado' };
const KINDS = ['Web', 'App', 'Landing', 'E-commerce', 'Sistema', 'Otro'];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const byId = (id) => S.projects.find((p) => p.id === Number(id));
const payById = (id) => S.payments.find((p) => p.id === Number(id));
const subById = (id) => S.subscriptions.find((x) => x.id === Number(id));
const pendingTasks = (id) => S.tasks.filter((t) => t.project_id === id && !t.done).length;

let toastTimer;
function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = bad ? 'show bad' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3500);
}

function errorText(e) {
  if (e?.code === '23503') return 'Este proyecto tiene recibos o gastos y no se puede borrar. Marcalo como Finalizado.';
  if (/Invalid login/i.test(e?.message)) return 'Email o contraseña incorrectos.';
  if (/fetch/i.test(e?.message)) return 'Sin conexión con el servidor. Revisá tu internet y probá de nuevo.';
  return e?.message || 'Algo salió mal. Probá de nuevo.';
}

// ---------- Arranque ----------

let sb;
if (SUPABASE_URL.includes('TU-PROYECTO')) {
  view.innerHTML = `<div class="auth"><h1>Falta configurar</h1><p class="muted">Completá <code>config.js</code> con la URL y la clave de tu proyecto de Supabase. Los pasos están en el README.</p></div>`;
} else {
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    if (user?.id === S.user?.id && S.settings) return;
    S.user = user;
    // fuera del callback: supabase-js se traba si se lo llama adentro
    setTimeout(() => (user ? load().catch((e) => toast(errorText(e), true)) : renderLogin()));
  });
  window.addEventListener('hashchange', route);
}

async function load() {
  // shortcut: trae todo de una (Supabase corta en 1000 filas); paginar los pagos si se pasa de ~900 recibos.
  const [settings, projects, payments, expenses, feeChanges, tasks, subscriptions] = await Promise.all([
    q(sb.from('settings').select('*').maybeSingle()),
    q(sb.from('projects').select('*').order('name')),
    q(sb.from('payments').select('*').order('receipt_no', { ascending: false })),
    q(sb.from('expenses').select('*').order('spent_on', { ascending: false })),
    q(sb.from('fee_changes').select('*').order('changed_at', { ascending: false })),
    q(sb.from('tasks').select('*').order('created_at')),
    q(sb.from('subscriptions').select('*').order('next_renewal')),
  ]);
  S.settings = settings ?? (await q(sb.from('settings').insert({}).select().single()));
  Object.assign(S, { projects, payments, expenses, feeChanges, tasks, subscriptions });
  loadMep();
  topBar.hidden = false;
  route();
}

// Dólar MEP (dolarapi.com, "bolsa"): se consulta al abrir la app o iniciar sesión, y al tocar el cuadro.
const mepBox = document.getElementById('mep');
async function loadMep() {
  const [value, sub] = ['.mep-value', '.mep-sub'].map((c) => mepBox.querySelector(c));
  mepBox.hidden = false;
  mepBox.classList.add('loading');
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/bolsa', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const when = new Date(d.fechaActualizacion).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    value.textContent = L.money(d.venta, 'ARS');
    sub.textContent = `compra ${L.money(d.compra, 'ARS')} · ${when}`;
    mepBox.title = `Dólar MEP: venta ${L.money(d.venta, 'ARS')}, compra ${L.money(d.compra, 'ARS')}, actualizado ${when}. Tocá para actualizar.`;
  } catch {
    value.textContent = 'Sin datos';
    sub.textContent = 'tocá para reintentar';
    mepBox.title = 'No se pudo consultar el dólar MEP. Tocá para reintentar.';
  } finally {
    mepBox.classList.remove('loading');
    mepBox.setAttribute('aria-label', mepBox.title);
  }
}
mepBox.addEventListener('click', loadMep);

function renderLogin() {
  topBar.hidden = true;
  view.innerHTML = `
    <form class="auth" data-form="login">
      <h1>Proyectos</h1>
      <p class="muted">Ingresá con tu cuenta.</p>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary">Ingresar</button>
    </form>`;
}

// ---------- Rutas ----------

const TAB = { proyecto: 'proyectos', nuevo: 'proyectos', editar: 'proyectos', pago: 'proyectos', aumento: 'proyectos', recibo: 'recibos', suscripcion: 'suscripciones' };
const routes = { panel, proyectos, proyecto, nuevo: () => projectForm(), editar: (id) => projectForm(byId(id)), pago: payForm, aumento, recibos, recibo, ajustes, suscripciones, suscripcion: (id) => subForm(subById(id)) };

function route() {
  if (!S.user || !S.settings) return;
  const [name, id] = location.hash.slice(2).split('/');
  const fn = routes[name] ?? panel;
  const tab = TAB[name] ?? (routes[name] ? name : 'panel');
  document.querySelectorAll('[data-tab]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === tab));
  view.innerHTML = fn(id);
  window.scrollTo(0, 0);
  if (name === 'recibo') prefetchPdf(payById(id));
}

// ---------- Piezas ----------

const badge = (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`;
const chargeBadge = (s) => s === 'vencido' ? badge('bad', 'Vencido') : s === 'cobrado' ? badge('ok', 'Cobrado') : badge('warn', 'Pendiente');
const statusBadge = (s) => badge(s === 'activo' ? 'ok' : s === 'desarrollo' ? 'info' : 'neutral', STATUS[s]);
const dueText = (p, s, today) => {
  if (!p.due_day) return 'sin día de cobro';
  const d = L.dueDate(p.due_day, today).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  return s === 'vencido' ? `venció el ${d}` : `vence el ${d}`;
};
const leftText = (n) => n === 0 ? 'hoy' : n > 0 ? `en ${n} día${n > 1 ? 's' : ''}` : `venció hace ${-n} día${n < -1 ? 's' : ''}`;
const empty = (title, text, action = '') => `<div class="empty"><p class="empty-title">${title}</p><p class="muted">${text}</p>${action}</div>`;
// timestamptz → fecha local (slice(0, 10) daría el día UTC, que de noche en Argentina ya es mañana)
const stampLabel = (ts) => new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
const avatar = (p, size = "") => p.icon
  ? `<img class="avatar ${size}" src="${esc(p.icon)}" alt="">`
  : `<span class="avatar ${size}" aria-hidden="true">${esc((p.name || "?").trim()[0]?.toUpperCase() ?? "?")}</span>`;

// Achica la imagen a 96px (recorte centrado) y la guarda como data URL: carga junto con el proyecto, sin pedir archivos aparte.
async function toIcon(file) {
  if (!file.type.startsWith("image/")) throw new Error("El ícono tiene que ser una imagen.");
  const img = await createImageBitmap(file).catch(() => { throw new Error("No se pudo leer la imagen."); });
  const n = 96, c = Object.assign(document.createElement("canvas"), { width: n, height: n });
  const side = Math.min(img.width, img.height);
  c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, n, n);
  const url = c.toDataURL("image/webp", 0.85); // Safari viejo devuelve PNG, que también entra
  if (url.length >= 60000) throw new Error("El ícono quedó muy pesado. Probá con otra imagen.");
  return url;
}

const curOptions = (cur) => ['ARS', 'USD'].map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('');

const LABEL = { cobrado: 'Cobrado', pendiente: 'Pendiente', gastos: 'Gastos', ganancia: 'Ganancia' };
const CUR = { ARS: 'Pesos', USD: 'Dólares' };
const totalsBlock = (totals, keys) => Object.entries(totals).map(([c, v]) => `
  <div class="totals">
    <p class="cur">${CUR[c]}</p>
    <dl>${keys.map((k) => `<div><dt>${LABEL[k]}</dt><dd class="${k === 'pendiente' && v[k] ? 'pending' : ''}${k === 'ganancia' && v[k] < 0 ? 'neg' : ''}">${L.money(v[k], c)}</dd></div>`).join('')}</dl>
  </div>`).join('');

function receiptRow(x) {
  const p = byId(x.project_id);
  return `<li><a class="row" href="#/recibo/${x.id}">
    <span class="num">${L.receiptLabel(x.receipt_no)}</span>
    <span class="row-main"><span class="title">${esc(p?.name ?? 'Proyecto borrado')}</span><span class="sub">${esc(L.periodLabel(x.period))} · ${esc(L.dateLabel(x.paid_on))}</span></span>
    <span class="amount ${x.voided_at ? 'voided' : ''}">${L.money(x.amount, x.currency)}</span>
    ${x.voided_at ? badge('bad', 'Anulado') : x.pdf_path ? '' : badge('warn', 'Sin PDF')}
  </a></li>`;
}

// ---------- Vistas ----------

function panel() {
  const today = new Date();
  const charges = S.projects
    .map((p) => ({ p, s: L.chargeStatus(p, S.payments, today) }))
    .filter((x) => x.s === 'pendiente' || x.s === 'vencido')
    .sort((a, b) => (a.s === 'vencido' ? -1 : 0) - (b.s === 'vencido' ? -1 : 0) || (a.p.due_day ?? 99) - (b.p.due_day ?? 99));
  const ren = [
    ...L.renewals(S.projects, today).map((r) => ({ ...r, title: `${r.label} · ${r.project.name}`, href: `#/proyecto/${r.project.id}` })),
    ...L.subscriptionRenewals(S.subscriptions, today).map((r) => ({ ...r, title: `Suscripción · ${r.sub.name}`, href: '#/suscripciones' })),
  ].sort((a, b) => a.left - b.left);
  const totals = L.monthTotals(S.projects, S.payments, S.expenses, today);

  if (!S.projects.length && !S.subscriptions.length) {
    return `<h1>Panel</h1>${empty('Todavía no cargaste proyectos', 'Cargá tus webs y apps con su cuota y fechas, y acá vas a ver qué cobrar y qué renovar cada mes.', '<a class="btn primary" href="#/nuevo">Nuevo proyecto</a>')}`;
  }
  return `
    <div class="head"><h1>${cap(L.periodLabel(L.period(today)))}</h1></div>
    ${S.settings.name ? '' : `<p class="notice">Completá tus datos en <a href="#/ajustes">Ajustes</a> para que salgan en los recibos.</p>`}
    ${totalsBlock(totals, ['cobrado', 'pendiente', 'gastos', 'ganancia'])}

    <section>
      <h2>Para cobrar</h2>
      ${charges.length ? `<ul class="list">${charges.map(({ p, s }) => `
        <li class="row">
          <a class="row-main has-avatar" href="#/proyecto/${p.id}">${avatar(p)}<span class="title">${esc(p.name)}</span><span class="sub">${esc(p.client || p.kind)} · ${dueText(p, s, today)}</span></a>
          <span class="amount">${L.money(p.fee, p.currency)}</span>
          ${chargeBadge(s)}
          <a class="btn sm" href="#/pago/${p.id}">Registrar pago</a>
        </li>`).join('')}</ul>` : `<p class="muted calm">Todo cobrado este mes.</p>`}
    </section>

    <section>
      <h2>Renovaciones próximas</h2>
      ${ren.length ? `<ul class="list">${ren.map((r) => `
        <li><a class="row" href="${r.href}">
          <span class="row-main"><span class="title">${esc(r.title)}</span><span class="sub">${esc(L.dateLabel(r.date))}</span></span>
          ${badge(r.left < 0 ? 'bad' : r.left <= 7 ? 'warn' : 'neutral', cap(leftText(r.left)))}
        </a></li>`).join('')}</ul>` : `<p class="muted calm">Nada vence en los próximos 30 días.</p>`}
    </section>`;
}

function proyectos() {
  const order = Object.keys(STATUS);
  const list = [...S.projects].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name, 'es'));
  const today = new Date();
  return `
    <div class="head"><h1>Proyectos</h1><div class="actions"><a class="btn" href="#/aumento">Aumento de cuotas</a><a class="btn primary" href="#/nuevo">Nuevo proyecto</a></div></div>
    ${list.length ? `<ul class="list">${list.map((p) => {
      const s = L.chargeStatus(p, S.payments, today);
      return `<li><a class="row" href="#/proyecto/${p.id}">
        <span class="row-main has-avatar">${avatar(p)}<span class="title">${esc(p.name)}</span><span class="sub">${esc(p.kind)}${p.client ? ' · ' + esc(p.client) : ''}${pendingTasks(p.id) ? ` · ${pendingTasks(p.id)} por hacer` : ''}</span></span>
        <span class="amount">${p.fee > 0 ? L.money(p.fee, p.currency) + '<small>/mes</small>' : ''}</span>
        ${s ? chargeBadge(s) : ''}${statusBadge(p.status)}
      </a></li>`;
    }).join('')}</ul>` : empty('Sin proyectos', 'Empezá cargando el primero.')}`;
}

function proyecto(id) {
  const p = byId(id);
  if (!p) return empty('No encontramos ese proyecto', 'Puede que se haya borrado.', '<a class="btn" href="#/proyectos">Ver proyectos</a>');
  const pays = S.payments.filter((x) => x.project_id === p.id);
  const exps = S.expenses.filter((x) => x.project_id === p.id);
  const fees = S.feeChanges.filter((x) => x.project_id === p.id);
  const tasks = S.tasks.filter((t) => t.project_id === p.id).sort((a, b) => a.done - b.done);
  const totals = L.projectTotals(p.id, S.payments, S.expenses);
  const safeUrl = /^https?:\/\//i.test(p.url) ? p.url : '';
  const row = (k, v) => v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '';
  return `
    <a class="back" href="#/proyectos">Proyectos</a>
    <div class="head">
      <h1>${avatar(p, "lg")}${esc(p.name)} ${statusBadge(p.status)}</h1>
      <div class="actions"><a class="btn" href="#/editar/${p.id}">Editar</a><a class="btn primary" href="#/pago/${p.id}">Registrar pago</a></div>
    </div>
    <dl class="details">
      ${row('Tipo', esc(p.kind))}
      ${row('Cliente', esc(p.client))}
      ${row('Contacto', esc(p.contact))}
      ${row('Sitio', safeUrl ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener">${esc(safeUrl.replace(/^https?:\/\//, ''))}</a>` : esc(p.url))}
      ${row('Cuota mensual', p.fee > 0 ? L.money(p.fee, p.currency) : '')}
      ${row('Día de cobro', p.due_day ? `Día ${p.due_day}` : '')}
      ${row('Inicio', p.start_date && esc(L.dateLabel(p.start_date)))}
      ${row('Renovación dominio', p.domain_renewal && esc(L.dateLabel(p.domain_renewal)))}
      ${row('Renovación hosting', p.hosting_renewal && esc(L.dateLabel(p.hosting_renewal)))}
      ${row('Próximo ajuste de cuota', p.next_adjust && esc(L.dateLabel(p.next_adjust)))}
    </dl>
    ${p.status === 'desarrollo' || tasks.length ? `<section>
      <h2>Por hacer</h2>
      <form class="task-add" data-form="task" data-id="${p.id}">
        <input name="text" required maxlength="500" placeholder="Anotá algo para hacer…" aria-label="Nueva tarea" autocomplete="off">
        <button class="btn primary">Agregar</button>
      </form>
      ${tasks.length ? `<ul class="list tasks">${tasks.map((t) => `
        <li class="row${t.done ? ' done' : ''}">
          <label class="check-inline"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>
          <button class="btn sm ghost" data-act="delete-task" data-id="${t.id}" aria-label="Borrar tarea ${esc(t.text)}">Borrar</button>
        </li>`).join('')}</ul>` : ''}
    </section>` : ''}
    ${p.notes ? `<section><h2>Notas</h2><p class="notes">${esc(p.notes)}</p></section>` : ''}
    ${Object.keys(totals).length ? `<section><h2>Balance del proyecto</h2>${totalsBlock(totals, ['cobrado', 'gastos', 'ganancia'])}</section>` : ''}

    <section>
      <h2>Contrato</h2>
      <div class="calm contract">
        ${p.contract_path ? `<div class="actions"><button class="btn" data-act="open-contract" data-id="${p.id}">Ver contrato</button><button class="btn danger" data-act="remove-contract" data-id="${p.id}">Quitar</button></div>` : ''}
        <form class="upload" data-form="contract" data-id="${p.id}">
          <label>${p.contract_path ? 'Reemplazar por otro PDF' : 'PDF del contrato'}<input name="file" type="file" accept="application/pdf" required></label>
          <button class="btn primary">${p.contract_path ? 'Reemplazar' : 'Subir contrato'}</button>
        </form>
      </div>
    </section>

    <section>
      <h2>Pagos</h2>
      ${pays.length ? `<ul class="list">${pays.map(receiptRow).join('')}</ul>` : `<p class="muted calm">Todavía no hay pagos registrados.</p>`}
    </section>

    <section>
      <div class="section-head"><h2>Gastos</h2>
        <details class="add"><summary class="btn sm">Agregar gasto</summary>
          <form class="form inline" data-form="expense" data-id="${p.id}">
            <label>Concepto<input name="concept" required maxlength="120" placeholder="Hosting, dominio, licencia…"></label>
            <label>Monto<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>
            <label>Moneda<select name="currency">${curOptions(p.currency)}</select></label>
            <label>Fecha<input name="spent_on" type="date" value="${L.isoDate(new Date())}" required></label>
            <div class="form-actions"><button class="btn primary">Guardar gasto</button></div>
          </form>
        </details>
      </div>
      ${exps.length ? `<ul class="list">${exps.map((e) => `
        <li class="row">
          <span class="row-main"><span class="title">${esc(e.concept)}</span><span class="sub">${esc(L.dateLabel(e.spent_on))}</span></span>
          <span class="amount">${L.money(e.amount, e.currency)}</span>
          <button class="btn sm ghost" data-act="delete-expense" data-id="${e.id}" aria-label="Borrar gasto ${esc(e.concept)}">Borrar</button>
        </li>`).join('')}</ul>` : `<p class="muted calm">Sin gastos cargados. Sumá lo que pagás vos (dominio, hosting, licencias) para ver la ganancia real.</p>`}
    </section>

    ${fees.length ? `<section><h2>Historial de cuota</h2><ul class="list">${fees.map((f) => `
      <li class="row">
        <span class="row-main"><span class="title">${L.money(f.old_fee, p.currency)} → ${L.money(f.new_fee, p.currency)}</span><span class="sub">${esc(stampLabel(f.changed_at))}</span></span>
        ${f.old_fee > 0 ? badge('neutral', `${f.new_fee >= f.old_fee ? '+' : ''}${((f.new_fee / f.old_fee - 1) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`) : ''}
      </li>`).join('')}</ul></section>` : ''}`;
}

function aumento() {
  const list = S.projects.filter((p) => p.status === 'activo' && p.fee > 0).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!list.length) return `<a class="back" href="#/proyectos">Proyectos</a>${empty('No hay cuotas para ajustar', 'El aumento aplica a proyectos activos con cuota mensual.')}`;
  return `
    <a class="back" href="#/proyectos">Proyectos</a>
    <h1>Aumento de cuotas</h1>
    <p class="muted">Sube la cuota de los proyectos que elijas. Cada cambio queda en el historial del proyecto.</p>
    <form class="form narrow" data-form="adjust">
      <label>Aumento (%)<input name="percent" type="number" step="0.1" min="0.1" max="1000" inputmode="decimal" required autofocus></label>
      <label>Redondear las cuotas en pesos a<select name="round"><option value="0.01">Sin redondeo</option><option value="100" selected>$ 100</option><option value="1000">$ 1.000</option></select></label>
      <fieldset class="checks"><legend>Proyectos</legend>
        ${list.map((p) => `
        <label class="check"><input type="checkbox" name="ids" value="${p.id}" ${p.currency === 'ARS' ? 'checked' : ''}>
          <span class="row-main"><span class="title">${esc(p.name)}</span><span class="sub" data-preview="${p.id}">${L.money(p.fee, p.currency)}</span></span>
        </label>`).join('')}
      </fieldset>
      <div class="form-actions"><button class="btn primary">Aplicar aumento</button></div>
    </form>`;
}

// Vista previa del aumento: actual → nueva, sin re-renderizar (mantiene el foco).
function updatePreview(form) {
  const percent = Number(form.percent.value) || 0;
  for (const box of form.querySelectorAll('[name=ids]')) {
    const p = byId(box.value);
    const next = L.adjustedFee(p.fee, percent, p.currency === 'ARS' ? Number(form.round.value) : 0.01);
    form.querySelector(`[data-preview="${p.id}"]`).textContent = box.checked && percent
      ? `${L.money(p.fee, p.currency)} → ${L.money(next, p.currency)}` : L.money(p.fee, p.currency);
  }
}

function projectForm(p) {
  const v = p ?? { kind: 'Web', status: 'activo', currency: 'ARS' };
  const opt = (map, cur) => Object.entries(map).map(([k, t]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${t}</option>`).join('');
  const f = (name, label, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(v[name])}" ${extra}></label>`;
  return `
    <a class="back" href="${p ? `#/proyecto/${p.id}` : '#/proyectos'}">${p ? esc(p.name) : 'Proyectos'}</a>
    <h1>${p ? 'Editar proyecto' : 'Nuevo proyecto'}</h1>
    <form class="form" data-form="project" data-id="${p?.id ?? ''}">
      <fieldset><legend>Proyecto</legend>
        ${f('name', 'Nombre', 'text', 'required autofocus')}
        ${f('kind', 'Tipo', 'text', 'list="kinds" required maxlength="40" placeholder="Web, App, Landing…"')}
        <datalist id="kinds">${[...new Set([...KINDS, ...S.projects.map((x) => x.kind)])].map((k) => `<option value="${esc(k)}">`).join('')}</datalist>
        <label>Estado<select name="status">${opt(STATUS, v.status)}</select></label>
        <div class="icon-field">${p ? avatar(v, "lg") : ""}<label>Ícono (opcional)<input name="icon_file" type="file" accept="image/*"></label>
          ${v.icon ? '<label class="check-inline"><input type="checkbox" name="icon_remove"> Quitar ícono</label>' : ""}</div>
        ${f('url', 'Sitio o link', 'url', 'placeholder="https://"')}
      </fieldset>
      <fieldset><legend>Cliente</legend>
        ${f('client', 'Cliente')}
        ${f('contact', 'Contacto', 'text', 'placeholder="Teléfono o email"')}
      </fieldset>
      <fieldset><legend>Cobro</legend>
        ${f('fee', 'Cuota mensual', 'number', 'min="0" step="0.01" inputmode="decimal"')}
        <label>Moneda<select name="currency">${opt({ ARS: 'Pesos (ARS)', USD: 'Dólares (USD)' }, v.currency)}</select></label>
        ${f('due_day', 'Día de cobro', 'number', 'min="1" max="31" inputmode="numeric" placeholder="1 a 31"')}
      </fieldset>
      <fieldset><legend>Fechas</legend>
        ${f('start_date', 'Inicio', 'date')}
        ${f('domain_renewal', 'Renovación del dominio', 'date')}
        ${f('hosting_renewal', 'Renovación del hosting', 'date')}
        ${f('next_adjust', 'Próximo ajuste de cuota', 'date')}
      </fieldset>
      <label class="wide">Notas<textarea name="notes" rows="4">${esc(v.notes)}</textarea></label>
      <div class="form-actions">
        <button class="btn primary">Guardar</button>
        ${p ? `<button type="button" class="btn danger" data-act="delete-project" data-id="${p.id}">Borrar proyecto</button>` : ''}
      </div>
    </form>`;
}

function payForm(id) {
  const p = byId(id);
  if (!p) return empty('No encontramos ese proyecto', '', '<a class="btn" href="#/proyectos">Ver proyectos</a>');
  const today = new Date();
  return `
    <a class="back" href="#/proyecto/${p.id}">${esc(p.name)}</a>
    <h1>Registrar pago</h1>
    <p class="muted">${esc(p.client || p.name)} · se genera el recibo ${L.receiptLabel(S.settings.next_receipt)}</p>
    <form class="form narrow" data-form="payment" data-id="${p.id}">
      <label>Importe<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="${p.fee > 0 ? p.fee : ''}" required autofocus></label>
      <label>Moneda<select name="currency"><option ${p.currency === 'ARS' ? 'selected' : ''}>ARS</option><option ${p.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
      <label>Mes que paga<input name="period" type="month" value="${L.period(today)}" required></label>
      <label>Fecha de pago<input name="paid_on" type="date" value="${L.isoDate(today)}" required></label>
      <label class="wide">Nota en el recibo<input name="note" type="text" placeholder="Opcional, ej.: transferencia"></label>
      <div class="form-actions"><button class="btn primary">Registrar y generar recibo</button></div>
    </form>`;
}

function recibos() {
  const { project, month } = S.filter;
  const list = S.payments.filter((x) => (!project || x.project_id === Number(project)) && (!month || x.period === month));
  const opts = [...S.projects].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((p) => `<option value="${p.id}" ${String(p.id) === project ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return `
    <div class="head"><h1>Recibos</h1></div>
    <div class="filters">
      <label>Proyecto<select data-filter="project"><option value="">Todos</option>${opts}</select></label>
      <label>Mes<input type="month" data-filter="month" value="${month}"></label>
      ${project || month ? '<button class="btn ghost" data-act="clear-filter">Limpiar</button>' : ''}
    </div>
    ${list.length ? `<ul class="list">${list.map(receiptRow).join('')}</ul>`
      : S.payments.length ? empty('Ningún recibo coincide', 'Probá con otro proyecto o mes.') : empty('Todavía no hay recibos', 'Se crean al registrar un pago desde un proyecto.')}`;
}

function recibo(id) {
  const x = payById(id);
  if (!x) return empty('No encontramos ese recibo', '', '<a class="btn" href="#/recibos">Ver recibos</a>');
  const p = byId(x.project_id);
  return `
    <a class="back" href="#/recibos">Recibos</a>
    <div class="head"><h1>Recibo ${L.receiptLabel(x.receipt_no)} ${x.voided_at ? badge('bad', 'Anulado') : ''}</h1></div>
    ${x.voided_at ? `<p class="notice bad">Anulado el ${esc(stampLabel(x.voided_at))}${x.void_reason ? `: ${esc(x.void_reason)}` : ''}. No cuenta como cobro y el número no se vuelve a usar.</p>` : ''}
    <dl class="details">
      <div><dt>Proyecto</dt><dd><a href="#/proyecto/${p?.id}">${esc(p?.name ?? '—')}</a></dd></div>
      <div><dt>Cliente</dt><dd>${esc(p?.client || '—')}</dd></div>
      <div><dt>Importe</dt><dd class="big">${L.money(x.amount, x.currency)}</dd></div>
      <div><dt>Mes</dt><dd>${esc(cap(L.periodLabel(x.period)))}</dd></div>
      <div><dt>Fecha de pago</dt><dd>${esc(L.dateLabel(x.paid_on))}</dd></div>
      ${x.note ? `<div><dt>Nota</dt><dd>${esc(x.note)}</dd></div>` : ''}
    </dl>
    <div class="actions">
      ${x.pdf_path
        ? `<button class="btn ${x.voided_at ? '' : 'primary'}" data-act="share" data-id="${x.id}">Compartir</button><button class="btn" data-act="open" data-id="${x.id}">Ver PDF</button>`
        : `<p class="notice">El pago quedó registrado pero el PDF no se pudo guardar.</p><button class="btn primary" data-act="make-pdf" data-id="${x.id}">Generar PDF</button>`}
    </div>
    ${x.voided_at ? '' : `
    <details class="add void">
      <summary class="btn sm ghost">Anular recibo</summary>
      <form class="form inline" data-form="void" data-id="${x.id}">
        <label class="wide">Motivo<input name="reason" required maxlength="200" placeholder="Ej.: importe mal cargado"></label>
        <p class="muted small wide">El recibo queda marcado como ANULADO, el mes vuelve a figurar pendiente y no se puede deshacer.</p>
        <div class="form-actions"><button class="btn primary danger">Anular recibo</button></div>
      </form>
    </details>`}`;
}

const CYCLE = { mensual: 'Mensual', anual: 'Anual' };

function suscripciones() {
  const today = new Date();
  const cost = L.monthlyCost(S.subscriptions);
  return `
    <div class="head"><h1>Suscripciones</h1><div class="actions"><a class="btn primary" href="#/suscripcion">Nueva suscripción</a></div></div>
    <p class="muted">Lo que pagás vos (Claude, hosting, dominios…). Aparecen en el Panel 30 días antes de renovar.</p>
    ${Object.keys(cost).length ? `<div class="totals"><dl>${Object.entries(cost).map(([c, v]) => `<div><dt>Por mes en ${CUR[c].toLowerCase()}</dt><dd>${L.money(v, c)}</dd></div>`).join('')}</dl></div>` : ''}
    ${S.subscriptions.length ? `<ul class="list subs">${S.subscriptions.map((x) => {
      const left = L.daysUntil(x.next_renewal, today);
      return `<li class="row">
        <a class="row-main" href="#/suscripcion/${x.id}"><span class="title">${esc(x.name)}</span><span class="sub">${CYCLE[x.cycle]} · renueva el ${esc(L.dateLabel(x.next_renewal))}</span></a>
        <span class="amount">${x.amount > 0 ? L.money(x.amount, x.currency) + `<small>/${x.cycle === 'anual' ? 'año' : 'mes'}</small>` : ''}</span>
        ${left <= 30 ? badge(left < 0 ? 'bad' : left <= 7 ? 'warn' : 'neutral', cap(leftText(left))) : ''}
        <button class="btn sm" data-act="renew-sub" data-id="${x.id}">Pagada</button>
      </li>`;
    }).join('')}</ul>` : empty('Sin suscripciones', 'Cargá las que pagás todos los meses o años y te avisamos antes de cada renovación.')}`;
}

function subForm(x) {
  const v = x ?? { currency: 'USD', cycle: 'mensual' };
  const f = (name, label, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(v[name])}" ${extra}></label>`;
  const opt = (map, cur) => Object.entries(map).map(([k, t]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${t}</option>`).join('');
  return `
    <a class="back" href="#/suscripciones">Suscripciones</a>
    <h1>${x ? 'Editar suscripción' : 'Nueva suscripción'}</h1>
    <form class="form narrow" data-form="subscription" data-id="${x?.id ?? ''}">
      ${f('name', 'Nombre', 'text', 'required autofocus maxlength="80" placeholder="Claude, hosting, dominio…"')}
      ${f('amount', 'Precio', 'number', 'min="0" step="0.01" inputmode="decimal"')}
      <label>Moneda<select name="currency">${opt({ USD: 'Dólares (USD)', ARS: 'Pesos (ARS)' }, v.currency)}</select></label>
      <label>Se paga<select name="cycle">${opt(CYCLE, v.cycle)}</select></label>
      ${f('next_renewal', 'Próxima renovación', 'date', 'required')}
      ${f('url', 'Link para pagar', 'url', 'placeholder="https://"')}
      <label>Notas<textarea name="notes" rows="3">${esc(v.notes)}</textarea></label>
      <div class="form-actions">
        <button class="btn primary">Guardar</button>
        ${x ? `<button type="button" class="btn danger" data-act="delete-sub" data-id="${x.id}">Borrar</button>` : ''}
      </div>
    </form>`;
}

function ajustes() {
  const s = S.settings;
  const f = (name, label, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(s[name])}" ${extra}></label>`;
  return `
    <h1>Ajustes</h1>
    <form class="form" data-form="settings">
      <fieldset><legend>Tus datos en los recibos</legend>
        ${f('name', 'Nombre o razón social', 'text', 'autocomplete="name"')}
        ${f('tax_id', 'CUIT / DNI')}
        ${f('address', 'Dirección', 'text', 'autocomplete="street-address"')}
        ${f('email', 'Email', 'email', 'autocomplete="email"')}
        ${f('phone', 'Teléfono', 'tel', 'autocomplete="tel"')}
      </fieldset>
      <fieldset><legend>Recibos</legend>
        ${f('next_receipt', 'Próximo número de recibo', 'number', 'min="1" step="1" required')}
        <label>Logo (PNG o JPG)<input name="logo" type="file" accept="image/png,image/jpeg"></label>
        ${s.logo_path ? `<p class="muted small">Ya tenés un logo cargado. <button type="button" class="link" data-act="remove-logo">Quitarlo</button></p>` : ''}
      </fieldset>
      <div class="form-actions"><button class="btn primary">Guardar</button></div>
    </form>
    <section>
      <h2 id="tema">Apariencia</h2>
      <div class="segmented" role="radiogroup" aria-labelledby="tema">
        ${[['', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, t]) => `
          <label><input type="radio" name="theme" value="${v}" data-theme-pick ${document.documentElement.dataset.theme === v ? 'checked' : ''}>${t}</label>`).join('')}
      </div>
      <p class="muted small">Automático sigue el modo del celular o la PC. Se guarda en este dispositivo.</p>
    </section>
    <section class="account">
      <h2>Cuenta</h2>
      <p class="muted">${esc(S.user.email)}</p>
      <button class="btn" data-act="logout">Cerrar sesión</button>
    </section>`;
}

// ---------- Acciones ----------

const toNull = (v) => (v === '' ? null : v);

const submit = {
  async login(fd) {
    await q(sb.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') }));
  },

  async project(fd, form) {
    const row = Object.fromEntries(fd);
    const iconFile = row.icon_file;
    delete row.icon_file; delete row.icon_remove;
    if (iconFile?.size) row.icon = await toIcon(iconFile);
    else if (fd.get('icon_remove')) row.icon = null;
    Object.assign(row, {
      name: row.name.trim(),
      kind: row.kind.trim(),
      fee: Number(row.fee || 0),
      due_day: row.due_day ? Number(row.due_day) : null,
      start_date: toNull(row.start_date), domain_renewal: toNull(row.domain_renewal), hosting_renewal: toNull(row.hosting_renewal),
      next_adjust: toNull(row.next_adjust),
    });
    const old = byId(form.dataset.id);
    const id = Number(form.dataset.id);
    const saved = id
      ? await q(sb.from('projects').update(row).eq('id', id).select().single())
      : await q(sb.from('projects').insert(row).select().single());
    S.projects = [...S.projects.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (old && Number(old.fee) !== Number(saved.fee)) await reloadFeeChanges(); // el trigger registró el cambio
    toast('Proyecto guardado');
    location.hash = `#/proyecto/${saved.id}`;
  },

  async payment(fd, form) {
    const pay = await q(sb.rpc('register_payment', {
      p_project: Number(form.dataset.id),
      p_paid_on: fd.get('paid_on'), p_period: fd.get('period'),
      p_amount: Number(fd.get('amount')), p_currency: fd.get('currency'), p_note: fd.get('note').trim(),
    }));
    S.payments.unshift(pay);
    S.settings.next_receipt = pay.receipt_no + 1;
    await savePdf(pay).catch((e) => toast('Pago registrado, pero falló el PDF: ' + errorText(e), true));
    location.hash = `#/recibo/${pay.id}`;
  },

  async expense(fd, form) {
    const e = await q(sb.from('expenses').insert({
      project_id: Number(form.dataset.id), concept: fd.get('concept').trim(),
      amount: Number(fd.get('amount')), currency: fd.get('currency'), spent_on: fd.get('spent_on'),
    }).select().single());
    S.expenses = [e, ...S.expenses].sort((a, b) => b.spent_on.localeCompare(a.spent_on));
    toast('Gasto guardado');
    route();
  },

  async task(fd, form) {
    const t = await q(sb.from('tasks').insert({ project_id: Number(form.dataset.id), text: fd.get('text').trim() }).select().single());
    S.tasks.push(t);
    rerender('[data-form=task] input');
  },

  async subscription(fd, form) {
    const row = Object.fromEntries(fd);
    Object.assign(row, { name: row.name.trim(), amount: Number(row.amount || 0), url: row.url.trim(), notes: row.notes.trim() });
    const id = Number(form.dataset.id);
    const saved = id
      ? await q(sb.from('subscriptions').update(row).eq('id', id).select().single())
      : await q(sb.from('subscriptions').insert(row).select().single());
    S.subscriptions = [...S.subscriptions.filter((x) => x.id !== saved.id), saved].sort(byRenewal);
    toast('Suscripción guardada');
    location.hash = '#/suscripciones';
  },

  async void(fd, form) {
    const x = payById(form.dataset.id);
    if (!confirm(`¿Anular el recibo ${L.receiptLabel(x.receipt_no)}? No se puede deshacer.`)) return;
    Object.assign(x, await q(sb.from('payments')
      .update({ voided_at: new Date().toISOString(), void_reason: fd.get('reason').trim() })
      .eq('id', x.id).select().single()));
    await savePdf(x).catch((e) => toast('Recibo anulado, pero no se pudo regenerar el PDF: ' + errorText(e), true));
    toast('Recibo anulado');
    route();
  },

  async contract(fd, form) {
    const file = fd.get('file');
    if (file.type !== 'application/pdf') throw new Error('El contrato tiene que ser un PDF.');
    if (file.size > 10e6) throw new Error('El PDF pesa más de 10 MB.');
    const p = byId(form.dataset.id);
    const path = `${S.user.id}/contratos/${p.id}.pdf`;
    await q(sb.storage.from('recibos').upload(path, file, { upsert: true, contentType: 'application/pdf' }));
    Object.assign(p, await q(sb.from('projects').update({ contract_path: path }).eq('id', p.id).select().single()));
    toast('Contrato guardado');
    route();
  },

  async adjust(fd) {
    const percent = Number(fd.get('percent'));
    const chosen = fd.getAll('ids').map(byId);
    if (!chosen.length) throw new Error('Elegí al menos un proyecto.');
    // el redondeo es para pesos: US$ 80 no debería saltar a US$ 100
    for (const [cur, round] of [['ARS', Number(fd.get('round'))], ['USD', 0.01]]) {
      const ids = chosen.filter((p) => p.currency === cur).map((p) => p.id);
      if (!ids.length) continue;
      const updated = await q(sb.rpc('adjust_fees', { p_projects: ids, p_percent: percent, p_round: round }));
      for (const u of updated) Object.assign(byId(u.id), u);
    }
    await reloadFeeChanges();
    toast(`Cuotas actualizadas (${chosen.length})`);
    location.hash = '#/proyectos';
  },

  async settings(fd) {
    const row = Object.fromEntries(['name', 'tax_id', 'address', 'email', 'phone'].map((k) => [k, fd.get(k).trim()]));
    row.next_receipt = Number(fd.get('next_receipt'));
    const logo = fd.get('logo');
    if (logo?.size) {
      if (logo.size > 2e6) throw new Error('El logo pesa más de 2 MB. Usá uno más liviano.');
      row.logo_path = `${S.user.id}/logo`;
      await q(sb.storage.from('recibos').upload(row.logo_path, logo, { upsert: true, contentType: logo.type }));
      logoCache = null;
    }
    S.settings = await q(sb.from('settings').update(row).eq('user_id', S.user.id).select().single());
    toast('Ajustes guardados');
    route();
  },
};

const actions = {
  async 'delete-project'(el) {
    const p = byId(el.dataset.id);
    if (!confirm(`¿Borrar "${p.name}"? No se puede deshacer.`)) return;
    await q(sb.from('projects').delete().eq('id', p.id));
    S.projects = S.projects.filter((x) => x.id !== p.id);
    toast('Proyecto borrado');
    location.hash = '#/proyectos';
  },
  async share(el) {
    const x = payById(el.dataset.id);
    const file = new File([await pdfBlob(x)], `${L.receiptLabel(x.receipt_no)}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Recibo ${L.receiptLabel(x.receipt_no)}` }).catch((e) => { if (e.name !== 'AbortError') throw e; });
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
    }
  },
  async open(el) {
    const w = window.open('', '_blank'); // abrir antes de esperar, si no el navegador lo bloquea
    const url = URL.createObjectURL(await pdfBlob(payById(el.dataset.id)));
    w ? (w.location = url) : (location.href = url);
  },
  async 'make-pdf'(el) {
    await savePdf(payById(el.dataset.id));
    toast('PDF generado');
    route();
  },
  async 'remove-logo'() {
    await q(sb.storage.from('recibos').remove([S.settings.logo_path]));
    S.settings = await q(sb.from('settings').update({ logo_path: null }).eq('user_id', S.user.id).select().single());
    logoCache = null;
    route();
  },
  async 'delete-expense'(el) {
    const e = S.expenses.find((x) => x.id === Number(el.dataset.id));
    if (!confirm(`¿Borrar el gasto "${e.concept}"?`)) return;
    await q(sb.from('expenses').delete().eq('id', e.id));
    S.expenses = S.expenses.filter((x) => x.id !== e.id);
    route();
  },
  async 'open-contract'(el) {
    const w = window.open('', '_blank');
    const blob = await q(sb.storage.from('recibos').download(byId(el.dataset.id).contract_path));
    const url = URL.createObjectURL(blob);
    w ? (w.location = url) : (location.href = url);
  },
  async 'remove-contract'(el) {
    const p = byId(el.dataset.id);
    if (!confirm('¿Quitar el contrato de este proyecto? Se borra el PDF.')) return;
    await q(sb.storage.from('recibos').remove([p.contract_path]));
    Object.assign(p, await q(sb.from('projects').update({ contract_path: null }).eq('id', p.id).select().single()));
    route();
  },
  async 'delete-task'(el) {
    const id = Number(el.dataset.id);
    await q(sb.from('tasks').delete().eq('id', id));
    S.tasks = S.tasks.filter((t) => t.id !== id);
    rerender();
  },
  async 'renew-sub'(el) {
    const x = subById(el.dataset.id);
    const next = L.addCycle(x.next_renewal, x.cycle);
    Object.assign(x, await q(sb.from('subscriptions').update({ next_renewal: next }).eq('id', x.id).select().single()));
    S.subscriptions.sort(byRenewal);
    toast(`${x.name}: próxima renovación el ${L.dateLabel(next)}`);
    rerender();
  },
  async 'delete-sub'(el) {
    const x = subById(el.dataset.id);
    if (!confirm(`¿Borrar la suscripción "${x.name}"?`)) return;
    await q(sb.from('subscriptions').delete().eq('id', x.id));
    S.subscriptions = S.subscriptions.filter((s) => s.id !== x.id);
    toast('Suscripción borrada');
    location.hash = '#/suscripciones';
  },
  'clear-filter'() { S.filter = { project: '', month: '' }; route(); },
  async logout() {
    await sb.auth.signOut();
    Object.assign(S, { settings: null, projects: [], payments: [], expenses: [], feeChanges: [], tasks: [], subscriptions: [] });
    pdfCache.clear();
    location.hash = '';
  },
};

view.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('.btn.primary');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await submit[form.dataset.form](new FormData(form), form);
  } catch (err) {
    toast(errorText(err), true);
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
});

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  el.disabled = true;
  try { await actions[el.dataset.act](el); } catch (err) { toast(errorText(err), true); } finally { el.disabled = false; }
});

view.addEventListener('input', (e) => {
  if (e.target.form?.dataset.form === 'adjust') updatePreview(e.target.form);
});

const byRenewal = (a, b) => a.next_renewal.localeCompare(b.next_renewal);
// Re-renderiza sin saltar arriba (para tildar o sumar tareas seguidas); `focus` vuelve a enfocar ese campo.
function rerender(focus) {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
  if (focus) view.querySelector(focus)?.focus({ preventScroll: true });
}

const reloadFeeChanges = async () => {
  S.feeChanges = await q(sb.from('fee_changes').select('*').order('changed_at', { ascending: false }));
};

view.addEventListener('change', (e) => {
  if (e.target.hasAttribute('data-theme-pick')) {
    window.applyTheme(e.target.value);
    try { localStorage.setItem('theme', e.target.value); } catch {}
    return;
  }
  if (e.target.dataset.task) return toggleTask(e.target);
  const k = e.target.dataset.filter;
  if (!k) return;
  S.filter[k] = e.target.value;
  route();
});

async function toggleTask(box) {
  const t = S.tasks.find((x) => x.id === Number(box.dataset.task));
  box.disabled = true;
  try {
    Object.assign(t, await q(sb.from('tasks').update({ done: box.checked }).eq('id', t.id).select().single()));
    rerender();
  } catch (err) {
    box.checked = !box.checked;
    box.disabled = false;
    toast(errorText(err), true);
  }
}

// ---------- PDF ----------

async function pdfBlob(x) {
  if (!pdfCache.has(x.id)) pdfCache.set(x.id, await q(sb.storage.from('recibos').download(x.pdf_path)));
  return pdfCache.get(x.id);
}
const prefetchPdf = (x) => { if (x?.pdf_path) pdfBlob(x).catch(() => {}); };

async function savePdf(x) {
  const blob = await makePdf(x);
  const path = L.receiptPath(S.user.id, byId(x.project_id)?.client, x.paid_on, x.receipt_no);
  await q(sb.storage.from('recibos').upload(path, blob, { upsert: true, contentType: 'application/pdf' }));
  const saved = await q(sb.from('payments').update({ pdf_path: path }).eq('id', x.id).select().single());
  Object.assign(x, saved);
  pdfCache.set(x.id, blob);
}

let logoCache = null;
async function logoDataUrl() {
  if (!S.settings.logo_path) return null;
  if (!logoCache) {
    const blob = await q(sb.storage.from('recibos').download(S.settings.logo_path));
    logoCache = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });
  }
  return logoCache;
}

async function makePdf(x) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ format: 'a5', unit: 'mm' });
  const p = byId(x.project_id) ?? {};
  const s = S.settings;
  const W = 148, M = 14, R = W - M;
  const ink = [24, 26, 31], gray = [104, 110, 122], line = [214, 218, 224];
  let y = M;

  const logo = await logoDataUrl().catch(() => null);
  if (logo) {
    const { width, height } = doc.getImageProperties(logo);
    const h = 14, w = Math.min(48, (h * width) / height);
    doc.addImage(logo, M, y, w, (w * height) / width);
    y += h + 4;
  }
  doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(12).text(s.name || ' ', M, y + 4);
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...gray);
  [s.tax_id && `CUIT/DNI ${s.tax_id}`, s.address, [s.email, s.phone].filter(Boolean).join(' · ')]
    .filter(Boolean).forEach((t, i) => doc.text(t, M, y + 9 + i * 4));

  doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(16).text('RECIBO', R, M + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).text(`N° ${L.receiptLabel(x.receipt_no)}`, R, M + 10, { align: 'right' });
  doc.setTextColor(...gray).setFontSize(8.5).text(`Fecha: ${L.parseDate(x.paid_on).toLocaleDateString('es-AR')}`, R, M + 15, { align: 'right' });

  y = Math.max(y + 22, 44);
  doc.setDrawColor(...line).setLineWidth(0.3).line(M, y, R, y);
  y += 10;

  const body = `Recibí de ${p.client || p.name || '—'} la suma de ${L.money(x.amount, x.currency)} en concepto de ${p.name || 'servicios'} – ${L.periodLabel(x.period)}.`;
  doc.setTextColor(...ink).setFontSize(11);
  const lines = doc.splitTextToSize(body, R - M);
  doc.text(lines, M, y);
  y += lines.length * 5.5 + 6;

  doc.setFillColor(243, 245, 248).roundedRect(M, y, R - M, 18, 2, 2, 'F');
  doc.setTextColor(...gray).setFontSize(8.5).text('TOTAL RECIBIDO', M + 5, y + 11);
  doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(15).text(L.money(x.amount, x.currency), R - 5, y + 12, { align: 'right' });
  y += 26;

  if (x.note) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...gray);
    doc.text(doc.splitTextToSize(`Nota: ${x.note}`, R - M), M, y);
  }

  const sy = 180;
  doc.setDrawColor(...gray).line(R - 56, sy, R, sy);
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...gray).text(s.name || 'Firma', R - 28, sy + 5, { align: 'center' });

  if (x.voided_at) {
    const red = [190, 30, 30];
    doc.setTextColor(...red).setFont('helvetica', 'bold').setFontSize(9)
      .text(doc.splitTextToSize(`ANULADO el ${new Date(x.voided_at).toLocaleDateString('es-AR')}${x.void_reason ? ` — ${x.void_reason}` : ''}`, R - M), M, y + 12);
    // sello diagonal centrado: jsPDF rota desde el punto de inicio, así que se corre medio ancho
    const a = 28 * Math.PI / 180;
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.22 }));
    doc.setFontSize(64);
    const w = doc.getTextWidth('ANULADO');
    doc.text('ANULADO', W / 2 - (w / 2) * Math.cos(a), 105 + (w / 2) * Math.sin(a), { angle: 28 });
    doc.restoreGraphicsState();
  }
  return doc.output('blob');
}

// ---------- PWA ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
