import { eachDate, planTeamSessions, weekdayOf } from './season-plan';

describe('season plan', () => {
  const terms = [
    { id: 't1', startDate: '2026-08-31', endDate: '2026-12-11' },
    { id: 't2', startDate: '2027-01-04', endDate: '2027-03-08' },
    { id: 't3', startDate: '2027-04-05', endDate: '2027-06-11' },
  ];
  const closures = [
    { startDate: '2026-12-02', endDate: '2026-12-03' },   // National Day (Wed, Thu)
    { startDate: '2027-05-15', endDate: '2027-05-18' },   // Eid al-Adha (Sat–Tue)
  ];
  const tt = { id: 'a', trainingDays: ['TUE', 'THU'], startTime: '18:00:00', endTime: '19:30:00' };
  const mwf = { id: 'b', trainingDays: ['MON', 'WED', 'FRI'], startTime: '19:30', endTime: '21:00' };

  it('knows the weekday of a date', () => {
    expect(weekdayOf('2026-08-31')).toBe('MON');
    expect(weekdayOf('2027-06-11')).toBe('FRI');
    expect(eachDate('2026-08-31', '2026-09-02')).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('a Tue/Thu team trains twice a week, every term week, minus holidays', () => {
    const p = planTeamSessions(tt, terms, closures);
    const t1 = p.filter((s) => s.termId === 't1');
    expect(t1).toHaveLength(15 * 2 - 1);                  // 15 weeks, National Day Thursday off
    expect(p.find((s) => s.date === '2026-12-03')).toBeUndefined();
    expect(p.find((s) => s.date === '2026-12-01')).toBeTruthy();
    expect(p.filter((s) => s.termId === 't3')).toHaveLength(10 * 2 - 1);   // Eid al-Adha Tuesday off
    expect(p.some((s) => s.date >= '2026-12-12' && s.date <= '2027-01-03')).toBe(false);   // winter break
  });

  it('uses Abu Dhabi time', () => {
    const first = planTeamSessions(tt, terms, [])[0];
    expect(first.date).toBe('2026-09-01');
    expect(first.startsAt.toISOString()).toBe('2026-09-01T14:00:00.000Z');
    expect(first.endsAt.toISOString()).toBe('2026-09-01T15:30:00.000Z');
  });

  it('a Mon/Wed/Fri team trains three times a week', () => {
    const p = planTeamSessions(mwf, terms, closures);
    expect(p.filter((s) => s.termId === 't1')).toHaveLength(15 * 3 - 1);   // National Day Wednesday off
    expect(p[0].date).toBe('2026-08-31');
    expect(p[p.length - 1].date).toBe('2027-06-11');
  });

  it('respects a date range and skips teams without a schedule', () => {
    expect(planTeamSessions(tt, terms, [], { from: '2026-10-01', to: '2026-10-31' }).map((s) => s.date))
      .toEqual(['2026-10-01', '2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
    expect(planTeamSessions({ id: 'x', trainingDays: [] }, terms, [])).toEqual([]);
  });
});
