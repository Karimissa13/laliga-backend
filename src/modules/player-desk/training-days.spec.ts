import { checkTrainingDays, daysText, dubaiWeekday } from './training-days';

describe('a child\'s own training days', () => {
  const TWT = ['TUE', 'WED', 'THU'];

  it('2× a week on a Tue/Wed/Thu team: two of its days, sorted', () => {
    expect(checkTrainingDays(TWT, ['THU', 'TUE'], 2)).toEqual({ days: ['TUE', 'THU'] });
  });
  it('every team day (or none chosen) means "all days" — nothing saved', () => {
    expect(checkTrainingDays(TWT, ['TUE', 'WED', 'THU'], 3)).toEqual({ days: null });
    expect(checkTrainingDays(TWT, [], 2)).toEqual({ days: null });
    expect(checkTrainingDays(TWT, null, 2)).toEqual({ days: null });
  });
  it('a day the team does not train on is refused', () => {
    expect(checkTrainingDays(TWT, ['MON', 'TUE'], 2)).toEqual({ error: "The team doesn't train on Mon (it trains Tue, Wed, Thu)." });
  });
  it('the number of days must match what the family pays for', () => {
    expect(checkTrainingDays(TWT, ['TUE'], 2)).toEqual({ error: 'This child pays for 2× a week — choose 2 days (1 chosen).' });
    expect(checkTrainingDays(TWT, ['WED'], 1)).toEqual({ days: ['WED'] });
  });
  it('a team with no days set cannot take a choice', () => {
    expect(checkTrainingDays([], ['TUE'], 1)).toHaveProperty('error');
  });
  it('weekday in Abu Dhabi time (8 pm UTC Monday is already Tuesday)', () => {
    expect(dubaiWeekday('2026-10-19T20:30:00Z')).toBe('TUE');
    expect(dubaiWeekday('2026-10-19T13:00:00Z')).toBe('MON');
    expect(daysText(['THU', 'TUE'])).toBe('Tue, Thu');
  });
});
