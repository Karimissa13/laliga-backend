import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Evaluation } from '../../database/entities';
import {
  ADVANCED_AREAS, ADVANCED_POSITION_WORD, ADVANCED_SCALE, DEVELOPMENT_AREAS, DEVELOPMENT_SCALE, PITCH_POSITIONS,
  ReportType, areaAverages, areasFor,
} from './report-templates';

export interface ReportInput {
  playerId?: string; termId?: string; reportType?: ReportType; coachId?: string | null;
  scores?: Record<string, number>; notes?: string | null; comments?: Record<string, string> | null;
  positions?: string[] | null; position?: string | null; shirtNumber?: number | null; photo?: string | null;
}

const LEVEL_TO_TYPE = (level?: string | null): ReportType => (level && level !== 'DEVELOPMENT' ? 'ADVANCED' : 'DEVELOPMENT');

/**
 * Term reports for every child: the Development report for Development squads
 * and the Advanced report for Advanced and HPC squads. A coach drafts, locks it
 * as final, and the office sends it to the parent (PDF by email and on the
 * parent's sign-in page).
 */
@Injectable()
export class DevelopmentReportsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Evaluation) private readonly evaluations: Repository<Evaluation>,
  ) {}

  templates() {
    return {
      DEVELOPMENT: { scale: DEVELOPMENT_SCALE, areas: DEVELOPMENT_AREAS, positions: PITCH_POSITIONS },
      ADVANCED: { scale: ADVANCED_SCALE, positions: Object.entries(ADVANCED_POSITION_WORD).map(([key, label]) => ({ key, label })), areasByPosition: ADVANCED_AREAS },
    };
  }

  private async currentTermId() {
    const [t] = await this.ds.query(`
      SELECT t.id FROM terms t JOIN seasons s ON s.id = t."seasonId"
      WHERE s."isActive" AND t.type = 'TERM' AND t."startDate" IS NOT NULL
      ORDER BY (t."startDate" <= (now() AT TIME ZONE 'Asia/Dubai')::date AND t."endDate" >= (now() AT TIME ZONE 'Asia/Dubai')::date) DESC,
               abs((now() AT TIME ZONE 'Asia/Dubai')::date - t."startDate") LIMIT 1`);
    return t?.id ?? null;
  }

  /**
   * The coaches' worklist for a term: every child enrolled in it (by team), the
   * report their squad needs and where it stands.
   */
  async board(q: { termId?: string; teamId?: string; coachId?: string; status?: string; type?: string; search?: string }) {
    const termId = q.termId ?? (await this.currentTermId());
    if (!termId) return { term: null, rows: [], counts: {} };
    const params: any[] = [termId];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const w: string[] = [];
    if (q.teamId) w.push(`t.id = ${p(q.teamId)}`);
    if (q.coachId) w.push(`t."headCoachId" = ${p(q.coachId)}`);
    if (q.search?.trim()) w.push(`(pl."firstName" || ' ' || pl."lastName") ILIKE ${p(`%${q.search.trim()}%`)}`);
    const rows: any[] = await this.ds.query(`
      SELECT DISTINCT ON (pl.id) pl.id AS "playerId", pl.reference, pl."firstName" || ' ' || pl."lastName" AS name, ag.code AS category,
             t.id AS "teamId", t.name AS team, t.level, t."headCoachId" AS "coachId", cu."fullName" AS coach,
             ev.id AS "reportId", ev."reportType", ev.status, ev."updatedAt", ev."sentAt", ev.scores, ev.position, eu."fullName" AS "writtenBy"
      FROM enrolments e
      JOIN players pl ON pl.id = e."playerId" AND pl."archivedAt" IS NULL
      LEFT JOIN teams t ON t.id = coalesce(e."teamId", pl."currentTeamId")
      LEFT JOIN age_groups ag ON ag.id = pl."ageGroupId"
      LEFT JOIN coaches c ON c.id = t."headCoachId" LEFT JOIN users cu ON cu.id = c."userId"
      LEFT JOIN evaluations ev ON ev."playerId" = pl.id AND ev."termId" = $1 AND ev."reportType" IS NOT NULL
      LEFT JOIN users eu ON eu.id = ev."evaluatorId"
      WHERE e."termId" = $1 AND e.status IN ('ACTIVE', 'PENDING', 'COMPLETED') ${w.length ? 'AND ' + w.join(' AND ') : ''}
      ORDER BY pl.id, ev."updatedAt" DESC NULLS LAST`, params);
    const [term] = await this.ds.query(`SELECT t.id, t.name, s.name AS season FROM terms t JOIN seasons s ON s.id = t."seasonId" WHERE t.id = $1`, [termId]);
    let out = rows.map((r) => {
      const type: ReportType = (r.reportType as ReportType) ?? LEVEL_TO_TYPE(r.level);
      const state = !r.reportId ? 'TODO' : r.sentAt ? 'SENT' : r.status;
      const avg = r.reportId ? areaAverages(type, r.position, r.scores || {}).overall : null;
      return { ...r, reportType: type, state, overall: avg, scores: undefined };
    });
    if (q.type) out = out.filter((r) => r.reportType === q.type);
    const counts = {
      total: out.length, todo: out.filter((r) => r.state === 'TODO').length, draft: out.filter((r) => r.state === 'DRAFT').length,
      final: out.filter((r) => r.state === 'FINAL').length, sent: out.filter((r) => r.state === 'SENT').length,
      development: out.filter((r) => r.reportType === 'DEVELOPMENT').length, advanced: out.filter((r) => r.reportType === 'ADVANCED').length,
    };
    if (q.status) out = out.filter((r) => r.state === q.status);
    out.sort((a, b) => (a.team ? 0 : 1) - (b.team ? 0 : 1) || String(a.team ?? '').localeCompare(String(b.team ?? ''), 'en', { numeric: true }) || a.name.localeCompare(b.name));
    return { term, counts, rows: out };
  }

  /** A report with everything the form and the PDF need. */
  async get(id: string) {
    const ev = await this.evaluations.findOne({ where: { id } });
    if (!ev || !ev.reportType) throw new NotFoundException('Report not found');
    return this.shape(ev);
  }

  private async shape(ev: Evaluation) {
    const [ctx] = await this.ds.query(`
      SELECT pl.id, pl.reference, pl."firstName", pl."lastName", pl."dateOfBirth"::text AS dob, pl."guardianId", ag.code AS category,
             t.name AS team, t.level, l.name AS location, tm.name AS term, tm."startDate"::text AS "termStart", tm."endDate"::text AS "termEnd",
             s.name AS season, extract(year from coalesce(s."startDate", tm."startDate"))::int AS "seasonFrom", cu."fullName" AS coach, eu."fullName" AS "writtenBy", fu."fullName" AS "finalizedBy"
      FROM players pl LEFT JOIN age_groups ag ON ag.id = pl."ageGroupId"
      LEFT JOIN teams t ON t.id = coalesce($2::uuid, pl."currentTeamId") LEFT JOIN locations l ON l.id = t."locationId"
      LEFT JOIN terms tm ON tm.id = $3::uuid LEFT JOIN seasons s ON s.id = tm."seasonId"
      LEFT JOIN coaches c ON c.id = $4::uuid LEFT JOIN users cu ON cu.id = c."userId"
      LEFT JOIN users eu ON eu.id = $5::uuid LEFT JOIN users fu ON fu.id = $6::uuid
      WHERE pl.id = $1`, [ev.playerId, ev.teamId ?? null, ev.termId ?? null, ev.coachId ?? null, ev.evaluatorId ?? null, ev.finalizedById ?? null]);
    const type = ev.reportType as ReportType;
    const avg = areaAverages(type, ev.position, (ev.scores || {}) as Record<string, number>);
    // The same report type in the child's previous term, for "since last term".
    const [prev] = await this.ds.query(`
      SELECT e.id, e.scores, e.position, tm.name AS term FROM evaluations e JOIN terms tm ON tm.id = e."termId"
      WHERE e."playerId" = $1 AND e."reportType" = $2 AND e.id <> $3 AND e.status = 'FINAL'
        AND tm."startDate" < coalesce((SELECT "startDate" FROM terms WHERE id = $4::uuid), now()::date)
      ORDER BY tm."startDate" DESC LIMIT 1`, [ev.playerId, type, ev.id, ev.termId ?? null]);
    const [att] = ctx?.termStart ? await this.ds.query(`
      SELECT count(*)::int AS marked, count(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE'))::int AS present
      FROM attendances a JOIN sessions s ON s.id = a."sessionId"
      WHERE a."playerId" = $1 AND NOT s."isCancelled" AND s."startsAt" >= ($2::date)::timestamp AT TIME ZONE 'Asia/Dubai'
        AND s."startsAt" < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai')`, [ev.playerId, ctx.termStart, ctx.termEnd]) : [null];
    return {
      id: ev.id, reportType: type, status: ev.status, sentAt: ev.sentAt ?? null, finalizedAt: ev.finalizedAt ?? null,
      playerId: ev.playerId, termId: ev.termId ?? null, teamId: ev.teamId ?? null, coachId: ev.coachId ?? null,
      scores: ev.scores || {}, notes: ev.notes ?? null, comments: ev.comments ?? {}, positions: ev.positions ?? [], position: ev.position ?? null,
      shirtNumber: ev.shirtNumber ?? null, photo: ev.photo ?? null, createdAt: ev.createdAt, updatedAt: ev.updatedAt,
      areas: areasFor(type, ev.position), scale: type === 'DEVELOPMENT' ? DEVELOPMENT_SCALE : ADVANCED_SCALE,
      averages: avg,
      previous: prev ? { id: prev.id, term: prev.term, averages: areaAverages(type, prev.position, prev.scores || {}) } : null,
      attendance: att && att.marked ? { marked: att.marked, present: att.present, rate: Math.round((att.present / att.marked) * 100) } : null,
      player: ctx ? { id: ctx.id, reference: ctx.reference, name: `${ctx.firstName} ${ctx.lastName}`, firstName: ctx.firstName, dob: ctx.dob,
        category: ctx.category, team: ctx.team, level: ctx.level, location: ctx.location, guardianId: ctx.guardianId } : null,
      term: ctx?.term ?? null, season: ctx?.season ?? null,
      seasonYears: ctx?.seasonFrom ? `${ctx.seasonFrom}/${String(ctx.seasonFrom + 1).slice(2)}` : null, coach: ctx?.coach ?? null, writtenBy: ctx?.writtenBy ?? null, finalizedBy: ctx?.finalizedBy ?? null,
    };
  }

  private validate(type: ReportType, input: ReportInput) {
    if (input.position != null && type === 'ADVANCED' && !ADVANCED_POSITION_WORD[input.position as keyof typeof ADVANCED_POSITION_WORD]) {
      throw new BadRequestException('Position is GOALKEEPER, DEFENDER, MIDFIELDER or FORWARD');
    }
    if (input.scores) {
      const scale = type === 'DEVELOPMENT' ? DEVELOPMENT_SCALE : ADVANCED_SCALE;
      const allowed = new Set(areasFor(type, input.position).flatMap((a) => a.items.map((i) => `${a.key}.${i.key}`)));
      for (const [k, v] of Object.entries(input.scores)) {
        if (!allowed.has(k)) throw new BadRequestException(`"${k}" is not on this report`);
        if (typeof v !== 'number' || !Number.isInteger(v) || v < scale.min || v > scale.max) throw new BadRequestException(`"${k}" must be ${scale.min}–${scale.max}`);
      }
    }
    if (input.positions) {
      const keys = new Set(PITCH_POSITIONS.map((x) => x.key));
      if (input.positions.length > 2 || input.positions.some((x) => !keys.has(x))) throw new BadRequestException('Up to two positions from the pitch');
    }
    if (input.photo && (!/^data:image\/(jpeg|png|webp);base64,/.test(input.photo) || input.photo.length > 400_000)) {
      throw new BadRequestException('The photo must be a JPEG or PNG under 300 KB');
    }
  }

  /** Start a child's report for a term (or return the one already started). */
  async create(input: ReportInput, user: { id?: string } = {}) {
    if (!input.playerId) throw new BadRequestException('playerId is required');
    const termId = input.termId ?? (await this.currentTermId());
    if (!termId) throw new BadRequestException('No term to report on');
    const [pl] = await this.ds.query(`
      SELECT pl.id, coalesce(e."teamId", pl."currentTeamId") AS "teamId", t.level, t."headCoachId", tm."seasonId"
      FROM players pl LEFT JOIN enrolments e ON e."playerId" = pl.id AND e."termId" = $2 AND e.status <> 'CANCELLED'
      LEFT JOIN teams t ON t.id = coalesce(e."teamId", pl."currentTeamId") LEFT JOIN terms tm ON tm.id = $2
      WHERE pl.id = $1 LIMIT 1`, [input.playerId, termId]);
    if (!pl) throw new NotFoundException('Player not found');
    const type: ReportType = input.reportType ?? LEVEL_TO_TYPE(pl.level);
    const existing = await this.evaluations.findOne({ where: { playerId: input.playerId, termId, reportType: type } });
    if (existing) return this.shape(existing);
    this.validate(type, input);
    const [me] = user.id ? await this.ds.query(`SELECT id FROM coaches WHERE "userId" = $1`, [user.id]) : [];
    const ev = await this.evaluations.save(this.evaluations.create({
      playerId: input.playerId, termId, seasonId: pl.seasonId ?? null, teamId: pl.teamId ?? null, reportType: type, status: 'DRAFT',
      coachId: input.coachId ?? me?.id ?? pl.headCoachId ?? undefined, evaluatorId: user.id,
      scores: input.scores ?? {}, notes: input.notes ?? undefined, comments: input.comments ?? null,
      positions: input.positions ?? null, position: type === 'ADVANCED' ? (input.position ?? 'MIDFIELDER') : null,
      shirtNumber: input.shirtNumber ?? null, photo: input.photo ?? null, isCustom: false,
    }));
    return this.shape(ev);
  }

  async update(id: string, input: ReportInput, user: { id?: string; canApprove?: boolean }) {
    const ev = await this.evaluations.findOne({ where: { id } });
    if (!ev || !ev.reportType) throw new NotFoundException('Report not found');
    if (ev.status === 'FINAL') throw new BadRequestException('This report is final — a super admin can reopen it');
    const type = ev.reportType as ReportType;
    const position = input.position !== undefined ? input.position : ev.position;
    this.validate(type, { ...input, position });
    const patch: Partial<Evaluation> = {};
    if (input.scores !== undefined) patch.scores = { ...(ev.scores || {}), ...input.scores };
    // A change of position changes the items: keep only the scores that still apply.
    if (input.position !== undefined && type === 'ADVANCED' && input.position !== ev.position) {
      const keep = new Set(areasFor(type, input.position).flatMap((a) => a.items.map((i) => `${a.key}.${i.key}`)));
      patch.scores = Object.fromEntries(Object.entries(patch.scores ?? ev.scores ?? {}).filter(([k]) => keep.has(k)));
      patch.position = input.position;
    }
    if (input.notes !== undefined) patch.notes = input.notes ?? undefined;
    if (input.comments !== undefined) patch.comments = { ...(ev.comments || {}), ...(input.comments || {}) };
    if (input.positions !== undefined) patch.positions = input.positions;
    if (input.shirtNumber !== undefined) patch.shirtNumber = input.shirtNumber;
    if (input.photo !== undefined) patch.photo = input.photo;
    if (input.coachId !== undefined) patch.coachId = input.coachId ?? undefined;
    await this.evaluations.update(id, patch);
    return this.get(id);
  }

  /** Lock the report: every item scored and the coach's words written. */
  async finalize(id: string, user: { id?: string }) {
    const r = await this.get(id);
    if (r.status === 'FINAL') return r;
    const missing = r.areas.flatMap((a) => a.items.filter((i) => typeof r.scores[`${a.key}.${i.key}`] !== 'number').map((i) => i.label));
    if (missing.length) throw new BadRequestException(`Score every item before making it final — ${missing.length} left (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})`);
    if (!r.notes?.trim()) throw new BadRequestException(r.reportType === 'DEVELOPMENT' ? 'Write the observations first' : 'Write the general comment first');
    if (r.reportType === 'ADVANCED') {
      const noComment = r.areas.filter((a) => a.comment && !(r.comments as any)[a.key]?.trim());
      if (noComment.length) throw new BadRequestException(`Write a comment for: ${noComment.map((a) => a.label).join(', ')}`);
    }
    await this.evaluations.update(id, { status: 'FINAL', finalizedAt: new Date(), finalizedById: user.id ?? null });
    return this.get(id);
  }

  async reopen(id: string, user: { canApprove?: boolean }) {
    if (!user.canApprove) throw new ForbiddenException('Only a super admin can reopen a final report');
    const ev = await this.evaluations.findOne({ where: { id } });
    if (!ev || !ev.reportType) throw new NotFoundException('Report not found');
    await this.evaluations.update(id, { status: 'DRAFT', finalizedAt: null, sentAt: null });
    return this.get(id);
  }

  async remove(id: string) {
    const ev = await this.evaluations.findOne({ where: { id } });
    if (!ev || !ev.reportType) throw new NotFoundException('Report not found');
    if (ev.status === 'FINAL') throw new BadRequestException('A final report can\'t be deleted — reopen it first');
    await this.evaluations.delete(id);
    return { id, deleted: true };
  }

  markSent(id: string) { return this.evaluations.update(id, { sentAt: new Date() }); }

  /** A child's reports, newest term first. */
  async forPlayer(playerId: string, finalOnly = false) {
    return this.ds.query(`
      SELECT e.id, e."reportType", e.status, e."sentAt", e."updatedAt", e.scores, e.position, tm.name AS term, s.name AS season, cu."fullName" AS coach
      FROM evaluations e LEFT JOIN terms tm ON tm.id = e."termId" LEFT JOIN seasons s ON s.id = tm."seasonId"
      LEFT JOIN coaches c ON c.id = e."coachId" LEFT JOIN users cu ON cu.id = c."userId"
      WHERE e."playerId" = $1 AND e."reportType" IS NOT NULL ${finalOnly ? `AND e.status = 'FINAL'` : ''}
      ORDER BY tm."startDate" DESC NULLS LAST, e."createdAt" DESC`, [playerId]).then((rows: any[]) => rows.map((r) => ({
      ...r, overall: areaAverages(r.reportType, r.position, r.scores || {}).overall, scores: undefined,
    })));
  }
}
