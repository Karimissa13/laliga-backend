import { deriveAgeGroupCode } from './age-group.util';

describe('deriveAgeGroupCode', () => {
  const cutoff = '2026-12-31';

  it('derives U12 for a player born 2015 at a 2026 cutoff', () => {
    expect(deriveAgeGroupCode('2015-03-01', cutoff)).toBe('U12');
  });

  it('derives U9 for a player born 2018', () => {
    expect(deriveAgeGroupCode('2018-09-01', cutoff)).toBe('U9');
  });

  it('derives U14 for a player born 2013', () => {
    expect(deriveAgeGroupCode('2013-02-20', cutoff)).toBe('U14');
  });

  it('handles a birthday after the cutoff month correctly', () => {
    // Born Dec 2016; at 2026-12-31 cutoff still 10 -> U11
    expect(deriveAgeGroupCode('2016-12-15', cutoff)).toBe('U11');
  });

  it('defaults cutoff to now when none supplied', () => {
    const code = deriveAgeGroupCode('2015-03-01');
    expect(code).toMatch(/^U\d+$/);
  });
});

import { placeInCategory } from './age-group.util';

describe('placeInCategory (academy rule: gap years play up)', () => {
  const academy = ['U6', 'U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U16', 'U18'];

  it('keeps a child in their own category when it exists', () => {
    const r = placeInCategory('U12', academy);
    expect(r).toMatchObject({ code: 'U12', playedUp: false });
  });

  it('plays U7 up to U8, U15 up to U16, U17 up to U18', () => {
    expect(placeInCategory('U7', academy)).toMatchObject({ code: 'U8', playedUp: true });
    expect(placeInCategory('U15', academy)).toMatchObject({ code: 'U16', playedUp: true });
    expect(placeInCategory('U17', academy)).toMatchObject({ code: 'U18', playedUp: true });
  });

  it('plays a child younger than U6 up to U6', () => {
    expect(placeInCategory('U5', academy)).toMatchObject({ code: 'U6', playedUp: true });
  });

  it('refuses to guess for a child older than the oldest group', () => {
    const r = placeInCategory('U19', academy);
    expect(r.code).toBeNull();
    expect(r.note).toMatch(/place manually/);
  });

  it('follows configuration: opening a U15 group stops U15 playing up', () => {
    expect(placeInCategory('U15', [...academy, 'U15'])).toMatchObject({ code: 'U15', playedUp: false });
  });

  it('explains itself', () => {
    expect(placeInCategory('U7', academy).note).toBe('U7 from date of birth — no U7 group, so plays up to U8');
  });

  it('is not fooled by input order', () => {
    expect(placeInCategory('U15', [...academy].reverse())).toMatchObject({ code: 'U16' });
  });
});
