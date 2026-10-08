/**
 * The two term reports, taken from the academy's existing ones.
 *
 * DEVELOPMENT — the Development squads' report (the old admin's evaluation
 * form): five areas scored 1–5, two positions on the pitch and the coach's
 * observations.
 *
 * ADVANCED — the Advanced and HPC squads' report (until now made by hand and
 * uploaded as a PDF): photo, shirt number and position; a general comment; then
 * a Technical–Tactical and a Conditional area that depend on the position, and
 * a Psychological area that is the same for everyone — each scored 0–5 with
 * the coach's comment beside it.
 */
export type ReportType = 'DEVELOPMENT' | 'ADVANCED';
export interface ReportItem { key: string; label: string }
export interface ReportArea { key: string; label: string; items: ReportItem[]; comment?: boolean }

const it = (label: string): ReportItem => ({ key: label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label });

// ------------------------------------------------------------- Development
export const DEVELOPMENT_SCALE = { min: 1, max: 5, labels: { 1: 'Needs improvement', 2: 'Average', 3: 'Above average', 4: 'Good', 5: 'Excellent' } as Record<number, string> };
export const DEVELOPMENT_AREAS: ReportArea[] = [
  { key: 'technical', label: 'Technical', items: ['Ball skills', 'Pass control', 'Carrying the ball', 'Shooting', 'Heading', 'Right foot', 'Left foot'].map(it) },
  { key: 'tactical', label: 'Tactical', items: ['Decision making', 'Offensive tactics', 'Defensive tactics'].map(it) },
  { key: 'physical', label: 'Physical and psychomotor', items: ['Strength', 'Speed', 'Endurance', 'Flexibility', 'Coordination', 'Laterality', 'Agility'].map(it) },
  { key: 'cognitive', label: 'Cognitive', items: ['Concentration', 'Competitiveness', 'Self-confidence', 'Focus'].map(it) },
  { key: 'attitude', label: 'Attitude', items: ['Solidarity and comradeship', 'Discipline', 'Manners and respect', 'Relationship with coach and group'].map(it) },
];
/** The eleven positions on the Development report's pitch (as in the old form). */
export const PITCH_POSITIONS: Array<{ key: string; label: string; x: number; y: number }> = [
  { key: 'GK', label: 'Goalkeeper', x: 0.5, y: 0.93 },
  { key: 'RB', label: 'Right back', x: 0.86, y: 0.74 }, { key: 'CB1', label: 'Centre back 1', x: 0.36, y: 0.78 },
  { key: 'CB2', label: 'Centre back 2', x: 0.64, y: 0.78 }, { key: 'LB', label: 'Left back', x: 0.14, y: 0.74 },
  { key: 'CM1', label: 'Midfielder 1', x: 0.5, y: 0.58 }, { key: 'CM2', label: 'Midfielder 2', x: 0.3, y: 0.46 },
  { key: 'CM3', label: 'Midfielder 3', x: 0.7, y: 0.46 },
  { key: 'RW', label: 'Right winger', x: 0.86, y: 0.28 }, { key: 'LW', label: 'Left winger', x: 0.14, y: 0.28 },
  { key: 'ST', label: 'Striker', x: 0.5, y: 0.17 },
];

// ---------------------------------------------------------------- Advanced
export const ADVANCED_SCALE = { min: 0, max: 5 };
export type AdvancedPosition = 'GOALKEEPER' | 'DEFENDER' | 'MIDFIELDER' | 'FORWARD';
export const ADVANCED_POSITION_WORD: Record<AdvancedPosition, string> = {
  GOALKEEPER: 'Goalkeeper', DEFENDER: 'Defender', MIDFIELDER: 'Midfielder', FORWARD: 'Striker',
};
const PSYCHOLOGICAL: ReportArea = {
  key: 'psychological', label: 'Psychological area', comment: true,
  items: ['Concentration', 'Overcoming', 'Failures handling', 'Team work', 'Discipline', 'Communication', 'Fair play'].map(it),
};
export const ADVANCED_AREAS: Record<AdvancedPosition, ReportArea[]> = {
  DEFENDER: [
    { key: 'technical_tactical', label: 'Technical – tactical area', comment: true,
      items: ['Open spaces defending', 'Anticipation and duels winning', 'Defence of the box', 'Line handling', 'Aerial game', 'Build-up', 'Long passing capacity'].map(it) },
    { key: 'conditional', label: 'Conditional area', comment: true,
      items: ['Explosive strength', 'Agility', 'Coordination', 'Laterality', 'Body positioning', 'Running speed in short spaces', 'Running speed in long spaces'].map(it) },
    PSYCHOLOGICAL,
  ],
  MIDFIELDER: [
    { key: 'technical_tactical', label: 'Technical – tactical area', comment: true,
      items: ['Pressing', 'Aerial game', 'Balls recovering', 'Finishing and attainment to the box', 'Capacity to break pressing lines by passing',
        'Capacity to break pressing lines by dribbling', 'Controls and turns in between lines', 'Short – mid passing capacity', 'Long passing capacity'].map(it) },
    { key: 'conditional', label: 'Conditional area', comment: true,
      items: ['Body positioning', 'Explosive strength', 'Displacement speed in short spaces', 'Coordination and turns in short spaces', 'Field covering (aerobic power)', 'Endurance strength'].map(it) },
    PSYCHOLOGICAL,
  ],
  FORWARD: [
    { key: 'technical_tactical', label: 'Technical – tactical area', comment: true,
      items: ['Pressing orientation', "Play back to the opponent's goal", 'Shooting', 'Finishing (1 touch)', 'Unmarks (check in – unmark to space)', 'Play between lines', 'Aerial game', 'Mobility'].map(it) },
    { key: 'conditional', label: 'Conditional area', comment: true,
      items: ['Body positioning', 'Explosive strength', 'Maximum strength', 'Running speed in short spaces', 'Running speed in large spaces'].map(it) },
    PSYCHOLOGICAL,
  ],
  // Not in the samples we had; built on the same pattern for the coaches to adjust.
  GOALKEEPER: [
    { key: 'technical_tactical', label: 'Technical – tactical area', comment: true,
      items: ['Handling and catching', 'Diving and saves', 'One-on-one situations', 'Positioning and angles', 'Command of the box (crosses)', 'Distribution with the hands', 'Distribution with the feet', 'Build-up participation'].map(it) },
    { key: 'conditional', label: 'Conditional area', comment: true,
      items: ['Explosive strength', 'Reaction speed', 'Agility', 'Coordination', 'Body positioning', 'Flexibility'].map(it) },
    PSYCHOLOGICAL,
  ],
};

export function areasFor(type: ReportType, position?: string | null): ReportArea[] {
  if (type === 'DEVELOPMENT') return DEVELOPMENT_AREAS;
  return ADVANCED_AREAS[(position as AdvancedPosition) || 'MIDFIELDER'] ?? ADVANCED_AREAS.MIDFIELDER;
}

/** Each area's average (1 decimal) and the overall average, from the item scores. */
export function areaAverages(type: ReportType, position: string | null | undefined, scores: Record<string, number>) {
  const out: Record<string, number | null> = {};
  const all: number[] = [];
  for (const a of areasFor(type, position)) {
    const v = a.items.map((i) => scores?.[`${a.key}.${i.key}`]).filter((x): x is number => typeof x === 'number');
    out[a.key] = v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
    all.push(...v);
  }
  return { areas: out, overall: all.length ? Math.round((all.reduce((s, x) => s + x, 0) / all.length) * 10) / 10 : null };
}
