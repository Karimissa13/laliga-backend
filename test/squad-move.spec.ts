import { discountPercentOf, evenPercents, moveCharge } from '../src/modules/player-desk/squad-move';

describe('moveCharge — the move-up / move-down arithmetic', () => {
  // The two-calendar rule (Karim, 12 Oct 2026), checked against the two live move-ups.
  it('LA-000004: U12 Development 2×/week → U12 HPC 3×/week from 16 Oct', () => {
    // new 14,027 × 81/101 = 11,249.38 · old unused 9,350 × 52/66 = 7,366.67 · to pay 3,882.71
    const c = moveCharge({ oldPrice: 9350, newPrice: 14027, oldRatio: 52 / 66, newRatio: 81 / 101, discountPercent: 0 });
    expect(c).toEqual({ newPart: 11249.38, oldPart: 7366.67, gross: 3882.71, discount: 0, amount: 3882.71, direction: 'UP' });
  });

  it('LA-000005: U13 Development 2×/week → U13 Advanced White 3×/week from 13 Oct', () => {
    // new 14,027 × 81/93 = 12,217.06 · old unused 9,350 × 54/66 = 7,650.00 · to pay 4,567.06
    const c = moveCharge({ oldPrice: 9350, newPrice: 14027, oldRatio: 54 / 66, newRatio: 81 / 93, discountPercent: 0 });
    expect([c.newPart, c.oldPart, c.amount]).toEqual([12217.06, 7650, 4567.06]);
  });

  it('applies the child\'s existing discount to the difference', () => {
    const c = moveCharge({ oldPrice: 5610, newPrice: 8415, oldRatio: 0.6, newRatio: 0.6, discountPercent: 15 });
    expect([c.newPart, c.oldPart, c.gross]).toEqual([5049, 3366, 1683]);
    expect(c.discount).toBe(252.45);      // 15% of 1,683
    expect(c.amount).toBe(1430.55);
  });

  it('fewer sessions gives a negative amount (to credit, if the desk chooses)', () => {
    const c = moveCharge({ oldPrice: 14027, newPrice: 9350, oldRatio: 0.5, newRatio: 0.5, discountPercent: 0 });
    expect(c.amount).toBe(-2338.5);
    expect(c.direction).toBe('DOWN');
  });

  it('a move before the first day uses the whole of both prices; shares are capped at 1', () => {
    expect(moveCharge({ oldPrice: 100, newPrice: 150, oldRatio: 1.4, newRatio: 1, discountPercent: 0 }).amount).toBe(50);
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
