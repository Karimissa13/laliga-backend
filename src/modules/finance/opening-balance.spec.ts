import { openingBalanceLines } from './opening-balance';

describe('balance from earlier seasons', () => {
  it('one line per old invoice still owed, oldest first; total = what is owed', () => {
    const r = openingBalanceLines([
      { number: 'INVAB-2210', date: '2025-02-10', total: 1050, paid: 500, legacyId: '2210' },
      { number: 'INVAB-1980', date: '2024-09-03', total: 3150, paid: 0 },
      { number: 'INVAB-2001', date: '2024-10-01', total: 735, paid: 735 },   // nothing owed: left out
    ]);
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.description, l.amount])).toEqual([
      ['INVAB-1980 of 03/09/2024 — invoiced AED 3150.00, paid AED 0.00', 3150],
      ['INVAB-2210 of 10/02/2025 — invoiced AED 1050.00, paid AED 500.00', 550],
    ]);
    expect(r.lines[1].legacyId).toBe('2210');
    expect(r.total).toBe(3700);
  });

  it('refuses duplicates, negative amounts and overpaid invoices (those are wallet credit)', () => {
    const r = openingBalanceLines([
      { number: 'INVAB-1', total: 100, paid: 0 },
      { number: 'INVAB-1', total: 100, paid: 0 },
      { number: 'INVAB-2', total: -5, paid: 0 },
      { number: 'INVAB-3', total: 100, paid: 150 },
    ]);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[2]).toMatch(/wallet/);
    expect(r.total).toBe(100);
  });

  it('rounds to fils', () => {
    expect(openingBalanceLines([{ number: 'INVAB-9', total: 100.334, paid: 0.1 }]).total).toBe(100.23);
  });
});
