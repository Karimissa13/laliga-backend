import {
  DEFAULT_SIBLING_LADDER, ladderFromParams, ladderPercent, ordinal,
} from './sibling-ladder';

describe('sibling ladder (academy policy: 1st full, 2nd 15%, 3rd 25%, 4th+ 25%)', () => {
  it('gives the first child no discount', () => {
    expect(ladderPercent(1)).toBe(0);
  });

  it('gives the second child 15% and the third 25%', () => {
    expect(ladderPercent(2)).toBe(15);
    expect(ladderPercent(3)).toBe(25);
  });

  it('holds at 25% for the fourth child and beyond', () => {
    expect(ladderPercent(4)).toBe(25);
    expect(ladderPercent(5)).toBe(25);
    expect(ladderPercent(9)).toBe(25);
  });

  it('ignores nonsense ranks rather than inventing a discount', () => {
    expect(ladderPercent(0)).toBe(0);
    expect(ladderPercent(-3)).toBe(0);
    expect(ladderPercent(2.5)).toBe(0);
  });

  describe('configuration via a discount row', () => {
    it('falls back to the default when params are absent or junk', () => {
      expect(ladderFromParams(undefined)).toEqual(DEFAULT_SIBLING_LADDER);
      expect(ladderFromParams({})).toEqual(DEFAULT_SIBLING_LADDER);
      expect(ladderFromParams({ tiers: 'nope' })).toEqual(DEFAULT_SIBLING_LADDER);
    });

    it('accepts a different ladder without a code change', () => {
      const l = ladderFromParams({ tiers: [10, 20, 30], beyond: 40 });
      expect(ladderPercent(2, l)).toBe(10);
      expect(ladderPercent(3, l)).toBe(20);
      expect(ladderPercent(4, l)).toBe(30);
      expect(ladderPercent(5, l)).toBe(40);
    });

    it('rejects percentages outside 0–100 instead of applying them', () => {
      // A typo of 150% must not produce a negative invoice.
      expect(ladderFromParams({ tiers: [150, 25] }).tiers).toEqual(DEFAULT_SIBLING_LADDER.tiers);
      expect(ladderFromParams({ tiers: [15, -5] }).tiers).toEqual(DEFAULT_SIBLING_LADDER.tiers);
    });

    it('defaults `beyond` to the last tier when it is not given', () => {
      expect(ladderFromParams({ tiers: [12, 18] }).beyond).toBe(18);
    });
  });

  it('words positions the way the invoice shows them', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
  });
});
