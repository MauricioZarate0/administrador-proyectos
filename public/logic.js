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

const live = (payments) => payments.filter((x) => !x.voided_at); // los anulados no cuentan como cobro

// Estado del cobro del mes actual: null si el proyecto no cobra cuota.
export function chargeStatus(project, payments, today) {
  if (project.status !== 'activo' || !(project.fee > 0)) return null;
  const p = period(today);
  if (live(payments).some((x) => x.project_id === project.id && x.period === p)) return 'cobrado';
  if (!project.due_day) return 'pendiente';
  return today.getDate() > dueDate(project.due_day, today).getDate() ? 'vencido' : 'pendiente';
}

// Renovaciones y ajustes de cuota vencidos o dentro de `days` días, de lo más urgente a lo menos.
export function renewals(projects, today, days = 30) {
  const out = [];
  for (const p of projects) {
    if (p.status === 'finalizado') continue;
    for (const [field, label] of [['domain_renewal', 'Dominio'], ['hosting_renewal', 'Hosting'], ['next_adjust', 'Ajuste de cuota']]) {
      if (!p[field]) continue;
      const left = daysUntil(p[field], today);
      if (left <= days) out.push({ project: p, label, date: p[field], left });
    }
  }
  return out.sort((a, b) => a.left - b.left);
}

const bucket = (t, cur) => (t[cur] ??= { cobrado: 0, pendiente: 0, gastos: 0, ganancia: 0 });
const withProfit = (t) => { for (const v of Object.values(t)) v.ganancia = v.cobrado - v.gastos; return t; };

// Totales del mes por moneda: cobrado, pendiente, gastos y ganancia.
export function monthTotals(projects, payments, expenses, today) {
  const t = {};
  const p = period(today);
  for (const x of live(payments)) if (x.period === p) bucket(t, x.currency).cobrado += Number(x.amount);
  for (const e of expenses) if (e.spent_on.startsWith(p)) bucket(t, e.currency).gastos += Number(e.amount);
  for (const pr of projects) {
    const s = chargeStatus(pr, payments, today);
    if (s === 'pendiente' || s === 'vencido') bucket(t, pr.currency).pendiente += Number(pr.fee);
  }
  return withProfit(t);
}

// Totales históricos de un proyecto por moneda.
export function projectTotals(projectId, payments, expenses) {
  const t = {};
  for (const x of live(payments)) if (x.project_id === projectId) bucket(t, x.currency).cobrado += Number(x.amount);
  for (const e of expenses) if (e.project_id === projectId) bucket(t, e.currency).gastos += Number(e.amount);
  return withProfit(t);
}

// Misma fórmula que adjust_fees en SQL (redondeo al múltiplo de `round`).
export const adjustedFee = (fee, percent, round = 1) => Math.round((fee * (1 + percent / 100)) / round) * round;

// Ruta del PDF en Storage: la policy exige que empiece con el id del usuario.
export const slug = (s) => (s || 'sin-cliente').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-cliente';
export const receiptPath = (userId, client, paidOn, n) =>
  `${userId}/${slug(client)}/${paidOn.slice(0, 4)}/${receiptLabel(n)}.pdf`;

// ---------- Suscripciones ----------

// Siguiente renovación: un mes o un año después (un 31 pasa al último día si el mes es más corto).
export function addCycle(s, cycle) {
  const d = parseDate(s);
  const m = d.getMonth() + (cycle === 'anual' ? 12 : 1);
  const last = new Date(d.getFullYear(), m + 1, 0).getDate();
  return isoDate(new Date(d.getFullYear(), m, Math.min(d.getDate(), last)));
}

// Suscripciones vencidas o que renuevan dentro de `days` días, de la más urgente a la menos.
export const subscriptionRenewals = (subs, today, days = 30) => subs
  .map((sub) => ({ sub, date: sub.next_renewal, left: daysUntil(sub.next_renewal, today) }))
  .filter((x) => x.left <= days)
  .sort((a, b) => a.left - b.left);

// Costo mensual por moneda (las anuales se prorratean en 12).
export function monthlyCost(subs) {
  const t = {};
  for (const s of subs) t[s.currency] = (t[s.currency] ?? 0) + Number(s.amount) / (s.cycle === 'anual' ? 12 : 1);
  return t;
}
