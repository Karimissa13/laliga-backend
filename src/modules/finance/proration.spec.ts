import { countByCalendar } from './proration.service';
import { Weekday } from '../../database/entities/enums';

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
