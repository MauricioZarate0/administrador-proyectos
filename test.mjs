import assert from 'node:assert/strict';
import { chargeStatus, renewals, monthTotals, projectTotals, adjustedFee, receiptLabel, receiptPath, daysUntil, dueDate, period } from './logic.js';

const today = new Date(2026, 10, 15); // 15 nov 2026
const p = (o) => ({ id: 1, status: 'activo', fee: 100, currency: 'ARS', due_day: 10, ...o });

assert.equal(period(today), '2026-11');
assert.equal(chargeStatus(p(), [], today), 'vencido');
assert.equal(chargeStatus(p({ due_day: 20 }), [], today), 'pendiente');
assert.equal(chargeStatus(p(), [{ project_id: 1, period: '2026-11' }], today), 'cobrado');
assert.equal(chargeStatus(p(), [{ project_id: 1, period: '2026-10' }], today), 'vencido');
assert.equal(chargeStatus(p({ status: 'pausado' }), [], today), null);
assert.equal(chargeStatus(p({ fee: 0 }), [], today), null);
assert.equal(dueDate(31, today).getDate(), 30); // noviembre tiene 30
assert.equal(chargeStatus(p({ due_day: 31 }), [], new Date(2026, 10, 30)), 'pendiente');

assert.equal(daysUntil('2026-11-15', today), 0);
assert.equal(daysUntil('2026-12-15', today), 30);
const r = renewals([p({ domain_renewal: '2026-12-01', hosting_renewal: '2027-06-01' }), p({ id: 2, domain_renewal: '2026-11-01' })], today);
assert.deepEqual(r.map((x) => x.left), [-14, 16]);

const t = monthTotals(
  [p(), p({ id: 2, currency: 'USD', fee: 50 })],
  [{ project_id: 2, period: '2026-11', currency: 'USD', amount: '50.00' }],
  [{ project_id: 1, spent_on: '2026-11-03', currency: 'ARS', amount: '30' }, { project_id: 1, spent_on: '2026-10-03', currency: 'ARS', amount: '999' }],
  today,
);
assert.deepEqual(t, { USD: { cobrado: 50, pendiente: 0, gastos: 0, ganancia: 50 }, ARS: { cobrado: 0, pendiente: 100, gastos: 30, ganancia: -30 } });

// recibo anulado: el mes vuelve a quedar pendiente y no suma
const voided = [{ project_id: 1, period: '2026-11', currency: 'ARS', amount: 100, voided_at: '2026-11-12T10:00:00Z' }];
assert.equal(chargeStatus(p(), voided, today), 'vencido');
assert.equal(monthTotals([p()], voided, [], today).ARS.cobrado, 0);

assert.deepEqual(
  projectTotals(1, [{ project_id: 1, currency: 'ARS', amount: 100 }, ...voided, { project_id: 2, currency: 'ARS', amount: 7 }], [{ project_id: 1, currency: 'ARS', amount: 40 }]),
  { ARS: { cobrado: 100, pendiente: 0, gastos: 40, ganancia: 60 } },
);

assert.equal(adjustedFee(45000, 8.5), 48825);
assert.equal(adjustedFee(45000, 8.5, 1000), 49000);
assert.equal(adjustedFee(80, 10, 1), 88);

assert.deepEqual(renewals([p({ next_adjust: '2026-11-25' })], today).map((x) => [x.label, x.left]), [['Ajuste de cuota', 10]]);

assert.equal(receiptLabel(7), 'R-0007');
assert.equal(receiptPath('u1', 'Panadería López S.A.', '2026-11-15', 12), 'u1/panaderia-lopez-s-a/2026/R-0012.pdf');
assert.equal(receiptPath('u1', '', '2026-11-15', 1), 'u1/sin-cliente/2026/R-0001.pdf');
console.log('ok');
