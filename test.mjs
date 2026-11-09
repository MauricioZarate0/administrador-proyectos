import assert from 'node:assert/strict';
import { chargeStatus, renewals, monthTotals, receiptLabel, receiptPath, daysUntil, dueDate, period } from './logic.js';

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
  today,
);
assert.deepEqual(t, { USD: { cobrado: 50, pendiente: 0 }, ARS: { cobrado: 0, pendiente: 100 } });

assert.equal(receiptLabel(7), 'R-0007');
assert.equal(receiptPath('u1', 'Panadería López S.A.', '2026-11-15', 12), 'u1/panaderia-lopez-s-a/2026/R-0012.pdf');
assert.equal(receiptPath('u1', '', '2026-11-15', 1), 'u1/sin-cliente/2026/R-0001.pdf');
console.log('ok');
