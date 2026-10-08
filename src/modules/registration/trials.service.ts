import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Lead, LeadActivity, LeadEvaluation, LeadStatus } from '../../database/entities';

export const EVALUATION_WORD: Record<string, string> = {
  DEVELOPMENT: 'Development', ADVANCED: 'Advanced', HPC: 'HPC', ADV_INVITE: 'Advanced invitation', NOT_READY: 'Not ready yet',
};
const ATTENDED_TO_OUTCOME: Record<string, string | null> = { YES: 'ATTENDED', NO: 'NO_SHOW', ANOTHER: 'ANOTHER_TRIAL', PENDING: null };
const BEFORE_TRIAL: LeadStatus[] = [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.TRIAL_BOOKED];
const dubaiDate = (d: Date) => new Date(d.getTime() + 4 * 3600000).toISOString().slice(0, 10);
const tomorrowTen = () => { const d = dubaiDate(new Date(Date.now() + 86400000)); return new Date(`${d}T10:00:00+04:00`); };

/**
 * The trials sheet, as a screen: every trial by date with the parent's
 * confirmation, the coach, whether the child came, the coach's evaluation, who
 * follows up and where that follow-up stands. Coaches add their evaluations.
 */
@Injectable()
export class TrialsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadActivity) private readonly activities: Repository<LeadActivity>,
    @InjectRepository(LeadEvaluation) private readonly evaluations: Repository<LeadEvaluation>,
  ) {}

  private log(leadId: string, type: string, body: string | null, meta: Record<string, any> | null, authorId?: string | null) {
    return this.activities.save(this.activities.create({ leadId, type, body, meta, authorId: authorId ?? null }));
  }

  async board(q: { from?: string; to?: string; type?: string; coachId?: string; attended?: string; followUp?: string; search?: string; assignedToId?: string }) {
    const today = dubaiDate(new Date());
    const shift = (days: number) => dubaiDate(new Date(Date.now() + days * 86400000));
    const from = q.from ?? shift(-14), to = q.to ?? shift(14);
    const params: any[] = [from, to];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const w = [`l."trialDate" >= ($1::date)::timestamp AT TIME ZONE 'Asia/Dubai'`, `l."trialDate" < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai')`];
    if (q.type) w.push(`coalesce(l."trialType", CASE WHEN t.level = 'DEVELOPMENT' THEN 'DEVELOPMENT' WHEN t.level IS NULL THEN 'DEVELOPMENT' ELSE 'ADVANCED' END) = ${p(q.type)}`);
    if (q.coachId) w.push(`coalesce(l."trialCoachId", s."coachId") = ${p(q.coachId)}`);
    if (q.assignedToId) w.push(`l."assignedToId" = ${p(q.assignedToId)}`);
    if (q.attended === 'PENDING') w.push(`l."trialOutcome" IS NULL`);
    else if (q.attended && ATTENDED_TO_OUTCOME[q.attended]) w.push(`l."trialOutcome" = ${p(ATTENDED_TO_OUTCOME[q.attended])}`);
    if (q.followUp === 'needed') w.push(`l."trialOutcome" IN ('ATTENDED', 'ANOTHER_TRIAL') AND l.status NOT IN ('REGISTERED', 'LOST') AND l."followUpOutcome" IS NULL`);
    if (q.followUp === 'evaluation') w.push(`l."trialOutcome" IN ('ATTENDED', 'ANOTHER_TRIAL') AND NOT EXISTS (SELECT 1 FROM lead_evaluations e WHERE e."leadId" = l.id)`);
    if (q.search?.trim()) {
      const s1 = p(`%${q.search.trim()}%`);
      w.push(`(l."playerName" ILIKE ${s1} OR l."guardianName" ILIKE ${s1} OR l.reference ILIKE ${s1} OR regexp_replace(l."guardianMobile", '\\D', '', 'g') LIKE ${p(`%${q.search.replace(/\D/g, '').replace(/^(971|0)/, '') || '~'}%`)})`);
    }
    const rows: any[] = await this.ds.query(`
      SELECT l.id, l.reference, l."playerName", l."playerDob"::text AS "playerDob", l."ageGroupLabel" AS category, l."playerGender",
             l."guardianName", l."guardianMobile", l."guardianEmail", l.status, l."trialDate", l."trialSessionId",
             coalesce(l."trialType", CASE WHEN t.level IS NULL OR t.level = 'DEVELOPMENT' THEN 'DEVELOPMENT' ELSE 'ADVANCED' END) AS "trialType",
             l."trialConfirmed", l."trialOutcome", l."trialEvaluation", l."followUpOutcome", l.level,
             coalesce(l."trialCoachId", s."coachId") AS "coachId", (l."trialCoachId" IS NULL AND s."coachId" IS NOT NULL) AS "coachFromTeam",
             l."assignedToId", au."fullName" AS "assignedToName", t.name AS team, t.level AS "teamLevel",
             (SELECT json_build_object('body', a.body, 'type', a.type, 'at', a."createdAt" AT TIME ZONE 'UTC', 'by', u."fullName")
                FROM lead_activities a LEFT JOIN users u ON u.id = a."authorId"
               WHERE a."leadId" = l.id AND a.body IS NOT NULL AND a.type IN ('COMMENT', 'CALL', 'WHATSAPP', 'EMAIL', 'SMS')
               ORDER BY a."createdAt" DESC LIMIT 1) AS "lastNote",
             (SELECT json_build_object('recommendation', e.recommendation, 'ratings', e.ratings, 'strengths', e.strengths, 'toImprove', e."toImprove",
                     'anotherTrial', e."anotherTrial", 'at', e."createdAt" AT TIME ZONE 'UTC', 'by', u."fullName")
                FROM lead_evaluations e LEFT JOIN users u ON u.id = e."authorId" WHERE e."leadId" = l.id ORDER BY e."createdAt" DESC LIMIT 1) AS evaluation
      FROM leads l
      LEFT JOIN sessions s ON s.id = l."trialSessionId"
      LEFT JOIN teams t ON t.id = coalesce(l."trialTeamId", s."teamId")
      LEFT JOIN users au ON au.id::text = l."assignedToId"
      WHERE ${w.join(' AND ')}
      ORDER BY l."trialDate", l."playerName" LIMIT 1000`, params);
    const counts = {
      total: rows.length,
      confirmed: rows.filter((r) => r.trialConfirmed).length,
      attended: rows.filter((r) => r.trialOutcome === 'ATTENDED' || r.trialOutcome === 'ANOTHER_TRIAL').length,
      noShow: rows.filter((r) => r.trialOutcome === 'NO_SHOW').length,
      pending: rows.filter((r) => !r.trialOutcome && dubaiDate(new Date(r.trialDate)) <= today).length,
      needEvaluation: rows.filter((r) => (r.trialOutcome === 'ATTENDED' || r.trialOutcome === 'ANOTHER_TRIAL') && !r.evaluation).length,
      needFollowUp: rows.filter((r) => (r.trialOutcome === 'ATTENDED' || r.trialOutcome === 'ANOTHER_TRIAL') && !r.followUpOutcome && !['REGISTERED', 'LOST'].includes(r.status)).length,
      joined: rows.filter((r) => r.status === 'REGISTERED').length,
    };
    return { from, to, today, counts, rows };
  }

  /** One cell of the sheet changed: confirmation, coach, attended, evaluation, who follows up, follow-up outcome. */
  async updateSheet(id: string, input: {
    trialType?: string; trialConfirmed?: boolean; trialCoachId?: string | null; attended?: string;
    trialEvaluation?: string | null; assignedToId?: string | null; followUpOutcome?: string | null; logComment?: boolean;
  }, authorId?: string) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    const patch: Partial<Lead> = {};
    const changed: string[] = [];
    if (input.trialType !== undefined) { patch.trialType = input.trialType; changed.push('trial type'); }
    if (input.trialConfirmed !== undefined) { patch.trialConfirmed = input.trialConfirmed; changed.push(input.trialConfirmed ? 'parent confirmed' : 'not confirmed'); }
    if (input.trialCoachId !== undefined) { patch.trialCoachId = input.trialCoachId; changed.push('coach'); }
    if (input.trialEvaluation !== undefined) {
      patch.trialEvaluation = input.trialEvaluation;
      if (input.trialEvaluation && EVALUATION_WORD[input.trialEvaluation] && input.trialEvaluation !== 'NOT_READY' && input.trialEvaluation !== 'ADV_INVITE') {
        patch.level = EVALUATION_WORD[input.trialEvaluation];
      }
      changed.push(`evaluation ${input.trialEvaluation ? EVALUATION_WORD[input.trialEvaluation] ?? input.trialEvaluation : 'cleared'}`);
    }
    if (input.assignedToId !== undefined) { (patch as any).assignedToId = input.assignedToId; changed.push('follow-up by'); }
    if (input.followUpOutcome !== undefined) { patch.followUpOutcome = input.followUpOutcome?.trim() || null; changed.push('follow-up'); }
    if (input.attended !== undefined) {
      if (!(input.attended in ATTENDED_TO_OUTCOME)) throw new BadRequestException('Attended is YES, NO, ANOTHER or PENDING');
      const outcome = ATTENDED_TO_OUTCOME[input.attended];
      patch.trialOutcome = outcome;
      if (outcome === 'ATTENDED' || outcome === 'ANOTHER_TRIAL') {
        if (BEFORE_TRIAL.includes(lead.status)) patch.status = LeadStatus.TRIAL_ATTENDED;
        // The follow-up after the trial: tomorrow, unless one is already set.
        if (!lead.nextFollowUpAt || new Date(lead.nextFollowUpAt) < new Date()) patch.nextFollowUpAt = tomorrowTen();
      } else if (outcome === 'NO_SHOW') {
        if (lead.status === LeadStatus.TRIAL_BOOKED || lead.status === LeadStatus.TRIAL_ATTENDED) patch.status = LeadStatus.CONTACTED;
        patch.nextFollowUpAt = tomorrowTen();
      } else if (lead.status === LeadStatus.TRIAL_ATTENDED) patch.status = LeadStatus.TRIAL_BOOKED;
      changed.push(`attended: ${input.attended.toLowerCase()}`);
    }
    if (!changed.length) return this.row(id);
    await this.leads.update(id, patch);
    // From the sheet, the chosen follow-up is also written as a dated comment (the drawer writes its own).
    if (input.followUpOutcome && input.logComment !== false) await this.log(id, 'COMMENT', input.followUpOutcome.trim(), { followUpOutcome: true }, authorId);
    const { logComment: _lc, ...meta } = input;
    await this.log(id, 'TRIAL_SHEET', null, { changed, ...meta }, authorId);
    return this.row(id);
  }

  private async row(id: string) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    const day = lead.trialDate ? dubaiDate(new Date(lead.trialDate)) : dubaiDate(new Date());
    const r = await this.board({ from: day, to: day, search: lead.reference });
    return r.rows.find((x) => x.id === id) ?? lead;
  }

  /** A coach's evaluation: it also records that the child came and sets the recommended level. */
  async evaluate(id: string, input: {
    recommendation: string; ratings?: Record<string, number>; strengths?: string; toImprove?: string;
    recommendedTeamId?: string; anotherTrial?: boolean;
  }, authorId?: string) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (!EVALUATION_WORD[input.recommendation]) throw new BadRequestException('Unknown recommendation');
    const [coach] = authorId ? await this.ds.query(`SELECT id FROM coaches WHERE "userId" = $1`, [authorId]) : [];
    const ev = await this.evaluations.save(this.evaluations.create({
      leadId: id, authorId: authorId ?? null, coachId: coach?.id ?? null, recommendation: input.recommendation,
      ratings: input.ratings ?? null, strengths: input.strengths?.trim() || null, toImprove: input.toImprove?.trim() || null,
      recommendedTeamId: input.recommendedTeamId ?? null, anotherTrial: !!input.anotherTrial,
    }));
    const patch: Partial<Lead> = {
      trialEvaluation: input.recommendation,
      trialOutcome: input.anotherTrial ? 'ANOTHER_TRIAL' : 'ATTENDED',
      trialFeedback: [input.strengths?.trim(), input.toImprove?.trim() ? `To work on: ${input.toImprove.trim()}` : null].filter(Boolean).join(' — ') || lead.trialFeedback || null,
    };
    if (!['NOT_READY', 'ADV_INVITE'].includes(input.recommendation)) patch.level = EVALUATION_WORD[input.recommendation];
    if (!lead.trialCoachId && coach?.id) patch.trialCoachId = coach.id;
    if (BEFORE_TRIAL.includes(lead.status)) patch.status = LeadStatus.TRIAL_ATTENDED;
    if (!lead.nextFollowUpAt || new Date(lead.nextFollowUpAt) < new Date()) patch.nextFollowUpAt = tomorrowTen();
    await this.leads.update(id, patch);
    await this.log(id, 'EVALUATION', patch.trialFeedback ?? null, { evaluationId: ev.id, recommendation: input.recommendation, ratings: input.ratings ?? null }, authorId);
    return { evaluation: ev, row: await this.row(id) };
  }

  evaluationsFor(id: string) {
    return this.ds.query(`SELECT e.*, u."fullName" AS by, t.name AS "recommendedTeam" FROM lead_evaluations e
      LEFT JOIN users u ON u.id = e."authorId" LEFT JOIN teams t ON t.id = e."recommendedTeamId"
      WHERE e."leadId" = $1 ORDER BY e."createdAt" DESC`, [id]);
  }
}
