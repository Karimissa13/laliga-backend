import { Squad, TeamLevel, Weekday } from '../../database/entities/enums';
import { clock, daysLabel, levelRank, slotLabel, teamLabel } from './team-label';

describe('team labels', () => {
  it('names teams the way the academy does', () => {
    expect(teamLabel({ ageCodes: ['U12'], level: TeamLevel.HPC })).toBe('U12 HPC');
    expect(teamLabel({ ageCodes: ['U14'], level: TeamLevel.ADVANCED, squad: Squad.BLUE })).toBe('U14 Advanced Blue');
    expect(teamLabel({ ageCodes: ['U9'], level: TeamLevel.ADVANCED })).toBe('U9 Advanced');
    expect(teamLabel({ ageCodes: ['U8'], level: TeamLevel.DEVELOPMENT, squadNumber: 2 })).toBe('U8 Development 2');
  });

  it('names a combined team U16/18', () => {
    expect(teamLabel({ ageCodes: ['U16', 'U18'], level: TeamLevel.DEVELOPMENT })).toBe('U16/18 Development');
  });

  it('orders HPC above White above Blue above Development', () => {
    const hpc = levelRank({ level: TeamLevel.HPC });
    const white = levelRank({ level: TeamLevel.ADVANCED, squad: Squad.WHITE });
    const blue = levelRank({ level: TeamLevel.ADVANCED, squad: Squad.BLUE });
    const dev = levelRank({ level: TeamLevel.DEVELOPMENT });
    expect(hpc).toBeLessThan(white);
    expect(white).toBeLessThan(blue);
    expect(blue).toBeLessThan(dev);
  });

  it('writes training days in week order regardless of input order', () => {
    expect(daysLabel([Weekday.THU, Weekday.TUE])).toBe('Tue & Thu');
    expect(daysLabel([Weekday.FRI, Weekday.MON, Weekday.WED])).toBe('Mon, Wed & Fri');
    expect(daysLabel([])).toBe('—');
  });

  it('writes times the way parents read them', () => {
    expect(clock('18:00:00')).toBe('6:00 pm');
    expect(clock('19:30')).toBe('7:30 pm');
    expect(slotLabel([Weekday.TUE, Weekday.THU], '18:00:00', '19:30:00')).toBe('Tue & Thu · 6:00–7:30 pm');
    expect(slotLabel([Weekday.MON, Weekday.WED, Weekday.FRI], '19:30:00', '21:00:00')).toBe('Mon, Wed & Fri · 7:30–9:00 pm');
  });
});
