// Lógica pura (sin DOM ni red). Probada en test.mjs.

const fmt = {};
export const money = (amount, currency) =>
  (fmt[currency] ??= new Intl.NumberFormat('es-AR', { style: 'currency', currency })).format(amount);

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const period = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
// 'AAAA-MM-DD' como fecha local (new Date('2026-11-09') sería UTC y en Argentina cae el día anterior)
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const daysUntil = (s, today) => Math.round((parseDate(s) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
export const receiptLabel = (n) => `R-${String(n).padStart(4, '0')}`;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const periodLabel = (p) => { const [y, m] = p.split('-'); return `${MESES[m - 1]} ${y}`; };
export const dateLabel = (s) => parseDate(s).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

// Día de cobro real del mes: un 31 en noviembre es el 30.
export const dueDate = (dueDay, today) => {
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return new Date(today.getFullYear(), today.getMonth(), Math.min(dueDay, last));
};

// Estado del cobro del mes actual: null si el proyecto no cobra cuota.
export function chargeStatus(project, payments, today) {
  if (project.status !== 'activo' || !(project.fee > 0)) return null;
  const p = period(today);
  if (payments.some((x) => x.project_id === project.id && x.period === p)) return 'cobrado';
  if (!project.due_day) return 'pendiente';
  return today.getDate() > dueDate(project.due_day, today).getDate() ? 'vencido' : 'pendiente';
}

// Renovaciones vencidas o dentro de `days` días, de la más urgente a la menos.
export function renewals(projects, today, days = 30) {
  const out = [];
  for (const p of projects) {
    if (p.status === 'finalizado') continue;
    for (const [field, label] of [['domain_renewal', 'Dominio'], ['hosting_renewal', 'Hosting']]) {
      if (!p[field]) continue;
      const left = daysUntil(p[field], today);
      if (left <= days) out.push({ project: p, label, date: p[field], left });
    }
  }
  return out.sort((a, b) => a.left - b.left);
}

// Totales del mes por moneda: cobrado y pendiente.
export function monthTotals(projects, payments, today) {
  const t = {};
  const add = (cur, key, n) => { t[cur] ??= { cobrado: 0, pendiente: 0 }; t[cur][key] += Number(n); };
  const p = period(today);
  for (const x of payments) if (x.period === p) add(x.currency, 'cobrado', x.amount);
  for (const pr of projects) {
    const s = chargeStatus(pr, payments, today);
    if (s === 'pendiente' || s === 'vencido') add(pr.currency, 'pendiente', pr.fee);
  }
  return t;
}

// Ruta del PDF en Storage: la policy exige que empiece con el id del usuario.
export const slug = (s) => (s || 'sin-cliente').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-cliente';
export const receiptPath = (userId, client, paidOn, n) =>
  `${userId}/${slug(client)}/${paidOn.slice(0, 4)}/${receiptLabel(n)}.pdf`;
