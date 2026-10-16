import { PACKAGE_LABEL } from '../finance/pricing';

/**
 * A family buys a term option — Term 1, Terms 1 & 2, Full season… — and that one
 * purchase becomes one enrolment per term. Everywhere the child's "term" is shown
 * it is the purchase that matters ("Full season"), not whichever of its
 * enrolments happens to sort first ("Term 3").
 */
export interface EnrolmentLike {
  id: string; termId: string; status: string; enrolledAt: Date | string;
  invoiceId?: string | null; package?: string | null; sessionsPerWeek?: number | null;
  /** The team's days this child attends (null = all of them). */
  trainingDays?: string[] | null;
  /** Set on the enrolment that replaced another in a squad move. */
  movedFromId?: string | null;
  term?: { id?: string; name?: string; startDate?: string | null; endDate?: string | null } | null;
  season?: { name?: string } | null; team?: { name?: string; trainingDays?: string[] | null } | null;
}

export interface Purchase {
  key: string;
  package: string | null;
  label: string;            // "Full season", "Terms 1 & 2", "Term 1"
  terms: Array<{ id: string; name: string; startDate: string | null; endDate: string | null; status: string; enrolmentId: string }>;
  termsText: string;        // "Term 1, Term 2, Term 3"
  season: string | null;
  team: string | null;
  status: string;
  sessionsPerWeek: number | null;
  /** The days this child trains: their own choice, else every day of the team. */
  trainingDays: string[];
  /** The team's training days, and whether the child chose fewer of them. */
  teamDays: string[];
  ownDays: boolean;
  enrolledAt: string;
  invoiceId: string | null;
  /** The term in progress today, else the next one, else the last. */
  currentTerm: { id: string; name: string } | null;
}

const RANK: Record<string, number> = { ACTIVE: 0, PENDING: 1, COMPLETED: 2, TRANSFERRED: 3, CANCELLED: 4 };
const dubaiToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

export function summarisePurchases(enrols: EnrolmentLike[], today = dubaiToday()): Purchase[] {
  const groups = new Map<string, EnrolmentLike[]>();
  for (const e of enrols) {
    const at = new Date(e.enrolledAt).toISOString().slice(0, 16);
    const key = e.invoiceId ? `inv:${e.invoiceId}` : e.package ? `pkg:${e.package}:${at}` : `enr:${e.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const out: Purchase[] = [];
  for (const [key, list] of groups) {
    // After a squad move a term has two enrolments on the same invoice: the old team's
    // (replaced) and the new team's. The purchase describes the child now: the new one.
    const replaced = new Set(list.map((e) => e.movedFromId).filter(Boolean) as string[]);
    const sorted = list.filter((e) => !replaced.has(e.id))
      .sort((a, b) => String(a.term?.startDate ?? '').localeCompare(String(b.term?.startDate ?? '')));
    const live = sorted.filter((e) => e.status !== 'CANCELLED');
    const pick = live.length ? live : sorted;
    const pkg = pick.find((e) => e.package)?.package ?? null;
    const terms = pick.map((e) => ({
      id: e.termId, name: e.term?.name ?? '—', startDate: e.term?.startDate ?? null, endDate: e.term?.endDate ?? null,
      status: e.status, enrolmentId: e.id,
    }));
    const now = terms.find((t) => t.startDate && t.endDate && t.startDate <= today && today <= t.endDate)
      ?? terms.find((t) => t.startDate && t.startDate > today) ?? terms[terms.length - 1] ?? null;
    const status = pick.map((e) => e.status).sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9))[0];
    out.push({
      key,
      package: pkg,
      label: pkg && PACKAGE_LABEL[pkg as keyof typeof PACKAGE_LABEL] ? PACKAGE_LABEL[pkg as keyof typeof PACKAGE_LABEL] : terms.map((t) => t.name).join(' & '),
      terms,
      termsText: terms.map((t) => t.name).join(', '),
      season: pick[0]?.season?.name ?? null,
      team: pick.find((e) => e.team?.name)?.team?.name ?? null,
      status,
      sessionsPerWeek: pick.find((e) => e.sessionsPerWeek)?.sessionsPerWeek ?? null,
      ...daysOf(pick, now?.id ?? null),
      enrolledAt: new Date(Math.min(...pick.map((e) => new Date(e.enrolledAt).getTime()))).toISOString(),
      invoiceId: pick.find((e) => e.invoiceId)?.invoiceId ?? null,
      currentTerm: now ? { id: now.id, name: now.name } : null,
    });
  }
  // Newest purchase first; within the same moment, the one with live terms first.
  return out.sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt) || (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));
}

/** The days of the term in progress (else any term of the purchase) — every enrolment of a purchase usually shares them. */
function daysOf(pick: EnrolmentLike[], termId: string | null) {
  const e = pick.find((x) => x.termId === termId && x.status !== 'CANCELLED') ?? pick.find((x) => x.status !== 'CANCELLED') ?? pick[0];
  const teamDays = [...(e?.team?.trainingDays ?? [])];
  const own = e?.trainingDays?.length ? [...e.trainingDays] : null;
  return { trainingDays: own ?? teamDays, teamDays, ownDays: !!own };
}

/**
 * The purchase that describes the child now: a live one covering today or later, else the
 * newest live one. A cancelled purchase never counts — a child whose only package was
 * cancelled has no current term (Karim, 13 Oct 2026).
 */
export function currentPurchase(ps: Purchase[], today = dubaiToday()): Purchase | null {
  const live = ps.filter((p) => p.status !== 'CANCELLED' && p.status !== 'TRANSFERRED');
  const covering = live.filter((p) => p.terms.some((t) => !t.endDate || t.endDate >= today));
  return covering.sort((a, b) => String(a.terms[0]?.startDate ?? '').localeCompare(String(b.terms[0]?.startDate ?? '')))[0]
    ?? live[0] ?? null;
}
