import { splitIncl, lineVat, packageForPositions, hoursPerSession, defaultSessionsPerWeek, PACKAGE_TERMS } from './pricing';

describe('pricing rules', () => {
  it('splits VAT-inclusive prices so they add back exactly', () => {
    for (const p of [4092, 2455, 1910, 4910, 3930, 6820, 5610, 3366, 2618, 6732, 5387, 9350, 8415, 5049, 3927, 10100, 8079, 14027, 10659, 350, 550, 600, 2558, 1535, 1194]) {
      const { net, vat } = splitIncl(p, 5);
      expect(Math.round((net + vat) * 100) / 100).toBe(p);
      expect(lineVat(net, 5, p)).toBe(vat);
    }
  });
  it('2,455 splits as 2,338.10 + 116.90', () => {
    expect(splitIncl(2455, 5)).toEqual({ net: 2338.1, vat: 116.9 });
    expect(lineVat(1000, 5, 2455, true)).toBe(50);
  });
  it('maps term sets to the six options', () => {
    expect(packageForPositions([0])).toBe('T1');
    expect(packageForPositions([1, 0])).toBe('T1_2');
    expect(packageForPositions([1, 2])).toBe('T2_3');
    expect(packageForPositions([2, 1, 0])).toBe('FULL');
    expect(packageForPositions([0, 2])).toBeNull();
    expect(PACKAGE_TERMS.FULL).toEqual([0, 1, 2]);
  });
  it('U6/U8 train an hour, the rest an hour and a half', () => {
    expect(hoursPerSession('U6')).toBe(1);
    expect(hoursPerSession('U8')).toBe(1);
    expect(hoursPerSession('U9')).toBe(1.5);
    expect(hoursPerSession('U18')).toBe(1.5);
  });
  it('the tier follows the team schedule, then the level', () => {
    expect(defaultSessionsPerWeek({ trainingDays: ['TUE', 'THU'], level: 'DEVELOPMENT' })).toBe(2);
    expect(defaultSessionsPerWeek({ trainingDays: ['MON', 'WED', 'FRI'], level: 'HPC' })).toBe(3);
    expect(defaultSessionsPerWeek({ level: 'ADVANCED' })).toBe(3);
    expect(defaultSessionsPerWeek(null)).toBe(2);
  });
});
