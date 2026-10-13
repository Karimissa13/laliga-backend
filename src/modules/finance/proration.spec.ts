import { countByCalendar, packageSessions } from './proration.service';
import { Weekday } from '../../database/entities/enums';

describe('package sessions = term weeks × sessions a week (13 Oct 2026)', () => {
  // The 2026/27 terms: 15, 9 and 10 weeks.
  const T1 = { id: '1', startDate: '2026-08-31', endDate: '2026-12-11', weeks: 15 };
  const T2 = { id: '2', startDate: '2027-01-04', endDate: '2027-03-08', weeks: 9 };
  const T3 = { id: '3', startDate: '2027-04-05', endDate: '2027-06-11', weeks: 10 };
  const TT = [Weekday.TUE, Weekday.THU], MWF = [Weekday.MON, Weekday.WED, Weekday.FRI];
  it('a full season at 2 a week is 68 sessions — holidays do not reduce it (LA-000008: was 66)', () => {
    expect(packageSessions([T1, T2, T3], '2026-08-31', TT, 2)).toMatchObject({ total: 68, left: 68, basis: 'package sessions' });
  });
  it('from 13 Oct 2026, 56 of 68 are left (12 Tue/Thu since 31 Aug)', () => {
    expect(packageSessions([T1, T2, T3], '2026-10-13', TT, 2)).toMatchObject({ total: 68, left: 56 });
  });
  it('each term on its own, and 3 a week', () => {
    expect(packageSessions([T1], '2026-08-31', TT, 2).total).toBe(30);
    expect(packageSessions([T2], '2027-01-04', TT, 2).total).toBe(18);
    expect(packageSessions([T3], '2027-04-05', TT, 2).total).toBe(20);
    expect(packageSessions([T1, T2, T3], '2026-08-31', MWF, 3).total).toBe(102);
  });
  it('1 a week on a Tue/Thu team: 34 for the season, sessions left scaled to it', () => {
    expect(packageSessions([T1, T2, T3], '2026-10-13', TT, 1)).toMatchObject({ total: 34, left: 28 });
  });
});

describe('proration by calendar (no team plan)', () => {
  const t1 = { id: 'a', startDate: '2026-08-31', endDate: '2026-09-13' }; // two weeks, Mon → Sun
  it('counts the team\'s training days only', () => {
    expect(countByCalendar([t1], '2026-08-31', [Weekday.TUE, Weekday.THU])).toEqual({ total: 4, left: 4 });
    expect(countByCalendar([t1], '2026-09-05', [Weekday.TUE, Weekday.THU])).toEqual({ total: 4, left: 2 });
  });
  it('spans several terms and skips the gap between them', () => {
    const t2 = { id: 'b', startDate: '2027-01-04', endDate: '2027-01-10' };
    expect(countByCalendar([t1, t2], '2027-01-05', [Weekday.TUE, Weekday.THU])).toEqual({ total: 6, left: 2 });
  });
  it('counts every day without training days', () => {
    expect(countByCalendar([t1], '2026-09-07')).toEqual({ total: 14, left: 7 });
  });
});
