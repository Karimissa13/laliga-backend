import { discountPercentOf, evenPercents, moveCharge } from '../src/modules/player-desk/squad-move';

describe('moveCharge — the move-up / move-down arithmetic', () => {
  it('full season U12, Development 2×/week → HPC 3×/week, 28 of 34 weeks left', () => {
    // (14,027 − 9,350) × 28/34 = 4,677 × 0.8235 ≈ 3,851.62
    const c = moveCharge({ oldPrice: 9350, newPrice: 14027, ratio: 0.8235, discountPercent: 0 });
    expect(c).toEqual({ gross: 3851.51, discount: 0, amount: 3851.51, direction: 'UP' });
  });

  it('applies the child\'s existing discount to the difference', () => {
    const c = moveCharge({ oldPrice: 5610, newPrice: 8415, ratio: 0.6, discountPercent: 15 });
    expect(c.gross).toBe(1683);           // (8,415 − 5,610) × 0.6
    expect(c.discount).toBe(252.45);      // 15%
    expect(c.amount).toBe(1430.55);
  });

  it('the same sessions a week costs nothing', () => {
    expect(moveCharge({ oldPrice: 9350, newPrice: 9350, ratio: 0.8, discountPercent: 10 }).direction).toBe('SAME');
  });

  it('fewer sessions gives a negative amount (to credit, if the desk chooses)', () => {
    const c = moveCharge({ oldPrice: 14027, newPrice: 9350, ratio: 0.5, discountPercent: 0 });
    expect(c.amount).toBe(-2338.5);
    expect(c.direction).toBe('DOWN');
  });

  it('a move before the first day charges the whole difference; the ratio is capped at 1', () => {
    expect(moveCharge({ oldPrice: 100, newPrice: 150, ratio: 1.4, discountPercent: 0 }).amount).toBe(50);
  });
});

describe('evenPercents', () => {
  it('adds up to exactly 100 with two decimals', () => {
    expect(evenPercents(2)).toEqual([50, 50]);
    expect(evenPercents(3)).toEqual([33.33, 33.33, 33.34]);
    expect(evenPercents(4)).toEqual([25, 25, 25, 25]);
    for (const n of [2, 3, 5]) expect(Math.round(evenPercents(n).reduce((a, b) => a + b, 0) * 100) / 100).toBe(100);
  });
});

describe('discountPercentOf', () => {
  it('reads the child\'s discount as a percentage of the list price', () => {
    expect(discountPercentOf(8904.76, 1335.71)).toBe(15);
    expect(discountPercentOf(5000, 0)).toBe(0);
    expect(discountPercentOf(0, 100)).toBe(0);
  });
});
