import { allocate, amountsFor, planProblem } from './instalments';

const plan = (amounts: number[], extra: any = {}) => amounts.map((a, i) => ({ seq: i + 1, percent: 0, amount: a, dueDate: `2027-0${i + 1}-01`, flag: 'NONE', waivedAmount: 0, ...extra[i] }));

describe('instalments', () => {
  it('splits a total by percentages and puts the rounding on the last one', () => {
    expect(amountsFor(1000, [33.33, 33.33, 33.34])).toEqual([333.3, 333.3, 333.4]);
    expect(amountsFor(26100.49, [40, 30, 30])).toEqual([10440.2, 7830.15, 7830.14]);
  });
  it('checks a plan: 2–5 rows, 100%, dates in order', () => {
    expect(planProblem([{ percent: 100, dueDate: '2027-01-01' }])).toMatch(/2 to 5/);
    expect(planProblem([{ percent: 50, dueDate: '2027-01-01' }, { percent: 40, dueDate: '2027-02-01' }])).toMatch(/90%/);
    expect(planProblem([{ percent: 50, dueDate: '2027-02-01' }, { percent: 50, dueDate: '2027-01-01' }])).toMatch(/before/);
    expect(planProblem([{ percent: 12.345, dueDate: '2027-01-01' }, { percent: 87.655, dueDate: '2027-02-01' }])).toMatch(/two decimals/);
    expect(planProblem([{ percent: 12.5, dueDate: '2027-01-01' }, { percent: 87.5, dueDate: '2027-02-01' }])).toBeNull();
  });
  it('fills instalments in order, and a tagged payment goes to its own instalment first', () => {
    const v = allocate(plan([400, 300, 300]), [{ amount: 300, direction: 'INBOUND', instalmentSeq: 3 }, { amount: 450, direction: 'INBOUND' }], { today: '2026-12-01' });
    expect(v.map((x) => [x.paid, x.state])).toEqual([[400, 'PAID'], [50, 'PART_PAID'], [300, 'PAID']]);
  });
  it('marks unpaid past-due instalments overdue and honours ready/waived', () => {
    const v = allocate(plan([500, 500, 500], { 1: { flag: 'READY' }, 2: { flag: 'WAIVED', waivedAmount: 500 } }), [], { today: '2027-01-15' });
    expect(v.map((x) => x.state)).toEqual(['OVERDUE', 'READY', 'WAIVED']);
  });
  it('takes refunds and general write-offs from the last instalments', () => {
    const v = allocate(plan([400, 300, 300]), [{ amount: 1000, direction: 'INBOUND' }, { amount: 200, direction: 'REFUND' }], { today: '2026-12-01' });
    expect(v.map((x) => x.remaining)).toEqual([0, 0, 200]);
    const w = allocate(plan([400, 300, 300]), [], { genericWriteOff: 350, today: '2026-12-01' });
    expect(w.map((x) => x.remaining)).toEqual([400, 250, 0]);
  });
});
