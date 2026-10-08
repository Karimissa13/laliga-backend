import { Squad, TeamLevel, Weekday } from '../../database/entities/enums';

/**
 * How the academy names and orders its teams. One place, so the team list, the
 * player table, invoices and filters all say "U12 Advanced White" the same way.
 */

const LEVEL_WORD: Record<TeamLevel, string> = {
  [TeamLevel.HPC]: 'HPC',
  [TeamLevel.ADVANCED]: 'Advanced',
  [TeamLevel.DEVELOPMENT]: 'Development',
};

const SQUAD_WORD: Record<Squad, string> = {
  [Squad.WHITE]: 'White',
  [Squad.BLUE]: 'Blue',
};

export interface TeamShape {
  ageCodes: string[];
  level: TeamLevel;
  squad?: Squad | null;
  squadNumber?: number | null;
}

/** "U12 HPC", "U14 Advanced Blue", "U8 Development 2", "U16/18 Development". */
export function teamLabel(t: TeamShape): string {
  const ages = t.ageCodes.length
    ? t.ageCodes[0] + t.ageCodes.slice(1).map((c) => '/' + c.replace(/^U/, '')).join('')
    : '—';
  const parts = [ages, LEVEL_WORD[t.level]];
  if (t.squad) parts.push(SQUAD_WORD[t.squad]);
  if (t.squadNumber) parts.push(String(t.squadNumber));
  return parts.join(' ');
}

/**
 * Sort order within an age group, highest first:
 * HPC (1st team) → Advanced White (2nd) → Advanced (only team) → Advanced Blue (3rd) → Development.
 */
export function levelRank(t: Pick<TeamShape, 'level' | 'squad'>): number {
  if (t.level === TeamLevel.HPC) return 1;
  if (t.level === TeamLevel.ADVANCED) {
    if (t.squad === Squad.WHITE) return 2;
    if (!t.squad) return 2;          // the only advanced team sits where White would
    if (t.squad === Squad.BLUE) return 3;
  }
  return 4;
}

/** Plain-English description of a level for parents and new staff. */
export function levelExplainer(t: Pick<TeamShape, 'level' | 'squad'>): string {
  if (t.level === TeamLevel.HPC) return '1st team — highest level';
  if (t.level === TeamLevel.ADVANCED && t.squad === Squad.WHITE) return '2nd team';
  if (t.level === TeamLevel.ADVANCED && t.squad === Squad.BLUE) return '3rd team';
  if (t.level === TeamLevel.ADVANCED) return 'the age group\'s advanced team';
  return 'development pathway';
}

const DAY_ORDER: Weekday[] = [
  Weekday.MON, Weekday.TUE, Weekday.WED, Weekday.THU, Weekday.FRI, Weekday.SAT, Weekday.SUN,
];
const DAY_WORD: Record<Weekday, string> = {
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun',
};

/** ["THU","TUE"] → "Tue & Thu";  ["MON","WED","FRI"] → "Mon, Wed & Fri". */
export function daysLabel(days: Weekday[] | null | undefined): string {
  if (!days || !days.length) return '—';
  const sorted = [...new Set(days)].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  const words = sorted.map((d) => DAY_WORD[d]);
  if (words.length === 1) return words[0];
  return words.slice(0, -1).join(', ') + ' & ' + words[words.length - 1];
}

/** "18:00:00" → "6:00 pm". */
export function clock(t?: string | null): string {
  if (!t) return '';
  const [hStr, m] = t.split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** "Tue & Thu · 6:00–7:30 pm" */
export function slotLabel(days?: Weekday[] | null, start?: string | null, end?: string | null): string {
  const d = daysLabel(days);
  if (!start || !end) return d;
  const s = clock(start), e = clock(end);
  // Collapse a shared suffix: "6:00 pm–7:30 pm" → "6:00–7:30 pm"
  const sameHalf = s.slice(-2) === e.slice(-2);
  return `${d} · ${sameHalf ? s.slice(0, -3) : s}–${e}`;
}
