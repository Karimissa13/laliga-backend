import { dubaiDatePlus, dubaiToday } from '../src/common/dubai-date';

describe('dubaiToday — the academy\'s calendar day', () => {
  it('after 8 pm UTC it is already tomorrow in Abu Dhabi', () => {
    expect(dubaiToday(new Date('2026-10-11T21:30:00Z'))).toBe('2026-10-12');
  });

  it('during the Abu Dhabi day it matches the UTC day', () => {
    expect(dubaiToday(new Date('2026-10-12T09:00:00Z'))).toBe('2026-10-12');
  });

  it('counts days from the Abu Dhabi day', () => {
    expect(dubaiDatePlus(14, new Date('2026-10-11T21:30:00Z'))).toBe('2026-10-26');
    expect(dubaiDatePlus(-1, new Date('2026-10-12T09:00:00Z'))).toBe('2026-10-11');
  });
});
