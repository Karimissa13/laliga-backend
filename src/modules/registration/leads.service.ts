import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import {
  Gender, Guardian, Lead, LeadActivity, LeadSource, LeadStatus, Session,
} from '../../database/entities';
import { ReferenceService } from '../../common/reference.service';
import { normaliseMobile } from '../../common/contact.util';
import { GuardiansService } from '../people/guardians.service';
import { PlayersService } from '../people/players.service';

/** How the desk talks about each stage. */
export const LEAD_STAGE_LABEL: Record<LeadStatus, string> = {
  NEW: 'New', CONTACTED: 'Contacted', TRIAL_BOOKED: 'Trial booked', TRIAL_ATTENDED: 'Trial done',
  OFFER_MADE: 'Awaiting decision', REGISTERED: 'Joined', LOST: 'Not joining',
};
const OPEN: LeadStatus[] = [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.TRIAL_BOOKED, LeadStatus.TRIAL_ATTENDED, LeadStatus.OFFER_MADE];
const CONTACT_TYPES = ['CALL', 'WHATSAPP', 'EMAIL', 'SMS'];

export interface LeadFilter {
  status?: LeadStatus | 'OPEN' | 'DUE'; source?: LeadSource; assignedToId?: string; category?: string;
  search?: string; createdFrom?: string; createdTo?: string; trialFrom?: string; trialTo?: string;
  hasComments?: 'yes' | 'no'; page?: number; limit?: number; skip?: number;
}

/** "14/03/2015", "14-03-2015" or "2015-03-14" → "2015-03-14". */
export function parseDob(v?: string | null): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Trials & Leads: every family that shows interest (website trial pop-up,
 * phone call, chat, walk-in) is one lead, worked through a short pipeline —
 * New → Contacted → Trial booked → Trial done → Awaiting decision → Joined
 * (or Not joining) — with a timeline of comments, calls and messages, a next
 * follow-up date, and conversion into a real registration.
 */
@Injectable()
export class LeadsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadActivity) private readonly activities: Repository<LeadActivity>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly refs: ReferenceService,
    private readonly guardiansService: GuardiansService,
    private readonly playersService: PlayersService,
  ) {}

  private log(leadId: string, type: string, body?: string | null, meta?: Record<string, any> | null, authorId?: string | null) {
    return this.activities.save(this.activities.create({ leadId, type, body: body ?? null, meta: meta ?? null, authorId: authorId ?? null }));
  }

  // ------------------------------------------------------------------- list

  async list(q: LeadFilter) {
    const params: any[] = [];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const w: string[] = [];
    if (q.status === 'OPEN') w.push(`l.status = ANY(${p(OPEN)}::leads_status_enum[])`);
    else if (q.status === 'DUE') w.push(`l.status = ANY(${p(OPEN)}::leads_status_enum[]) AND l."nextFollowUpAt" < ((now() AT TIME ZONE 'Asia/Dubai')::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai'`);
    else if (q.status) w.push(`l.status = ${p(q.status)}`);
    if (q.source) w.push(`l.source = ${p(q.source)}`);
    if (q.assignedToId === 'none') w.push(`l."assignedToId" IS NULL`);
    else if (q.assignedToId) w.push(`l."assignedToId" = ${p(q.assignedToId)}`);
    if (q.category) w.push(`l."ageGroupLabel" = ${p(q.category)}`);
    if (q.createdFrom) w.push(`l."createdAt" >= (${p(q.createdFrom)}::date)::timestamp AT TIME ZONE 'Asia/Dubai'`);
    if (q.createdTo) w.push(`l."createdAt" < ((${p(q.createdTo)}::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai')`);
    if (q.trialFrom) w.push(`l."trialDate" >= (${p(q.trialFrom)}::date)::timestamp AT TIME ZONE 'Asia/Dubai'`);
    if (q.trialTo) w.push(`l."trialDate" < ((${p(q.trialTo)}::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai')`);
    if (q.hasComments === 'yes') w.push(`EXISTS (SELECT 1 FROM lead_activities a WHERE a."leadId" = l.id AND a.type = 'COMMENT')`);
    if (q.hasComments === 'no') w.push(`NOT EXISTS (SELECT 1 FROM lead_activities a WHERE a."leadId" = l.id AND a.type = 'COMMENT')`);
    if (q.search) {
      const s = p(`%${q.search.trim()}%`);
      const digits = q.search.replace(/\D/g, '');
      w.push(`(l."guardianName" ILIKE ${s} OR l."playerName" ILIKE ${s} OR l."guardianEmail" ILIKE ${s} OR l.reference ILIKE ${s}
        ${digits.length >= 4 ? `OR regexp_replace(l."guardianMobile", '\\D', '', 'g') LIKE ${p(`%${digits.replace(/^(971|0)/, '')}%`)}` : ''})`);
    }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const page = Math.max(q.page ?? 1, 1);
    const [{ n }] = await this.ds.query(`SELECT count(*)::int AS n FROM leads l ${where}`, params);
    const rows: any[] = await this.ds.query(`
      SELECT l.*, l."playerDob"::text AS "playerDob", u."fullName" AS "assignedToName", t.name AS "trialTeamName",
             (SELECT json_build_object('type', a.type, 'body', a.body, 'at', a."createdAt" AT TIME ZONE 'UTC', 'by', au."fullName")
                FROM lead_activities a LEFT JOIN users au ON au.id = a."authorId"
               WHERE a."leadId" = l.id AND a.type NOT IN ('CREATED') ORDER BY a."createdAt" DESC LIMIT 1) AS "lastActivity",
             (SELECT count(*)::int FROM lead_activities a WHERE a."leadId" = l.id AND a.type = 'COMMENT') AS comments
      FROM leads l LEFT JOIN users u ON u.id::text = l."assignedToId" LEFT JOIN teams t ON t.id = l."trialTeamId"
      ${where}
      ORDER BY (l.status = ANY(${p(OPEN)}::leads_status_enum[])) DESC,
               COALESCE(l."nextFollowUpAt", l."createdAt") ASC
      LIMIT ${p(limit)} OFFSET ${p((page - 1) * limit)}`, params);
    return { data: rows, meta: { total: n, page, limit, pages: Math.max(1, Math.ceil(n / limit)) } };
  }

  /** Counts for the stage tabs and the "needs you today" strip. */
  async stats() {
    const [r] = await this.ds.query(`
      SELECT count(*) FILTER (WHERE status = 'NEW')::int AS "NEW",
             count(*) FILTER (WHERE status = 'CONTACTED')::int AS "CONTACTED",
             count(*) FILTER (WHERE status = 'TRIAL_BOOKED')::int AS "TRIAL_BOOKED",
             count(*) FILTER (WHERE status = 'TRIAL_ATTENDED')::int AS "TRIAL_ATTENDED",
             count(*) FILTER (WHERE status = 'OFFER_MADE')::int AS "OFFER_MADE",
             count(*) FILTER (WHERE status = 'REGISTERED')::int AS "REGISTERED",
             count(*) FILTER (WHERE status = 'LOST')::int AS "LOST",
             count(*) FILTER (WHERE status = ANY($1::leads_status_enum[]) AND "nextFollowUpAt" < ((now() AT TIME ZONE 'Asia/Dubai')::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai')::int AS due,
             count(*) FILTER (WHERE status = ANY($1::leads_status_enum[]) AND "nextFollowUpAt" < now() - interval '1 day')::int AS overdue,
             count(*) FILTER (WHERE status = 'NEW' AND "createdAt" < now() - interval '1 day')::int AS "newWaiting",
             count(*) FILTER (WHERE "trialDate" >= (now() AT TIME ZONE 'Asia/Dubai')::date::timestamp AT TIME ZONE 'Asia/Dubai'
                               AND "trialDate" < ((now() AT TIME ZONE 'Asia/Dubai')::date + 7)::timestamp AT TIME ZONE 'Asia/Dubai')::int AS "trialsThisWeek",
             count(*) FILTER (WHERE "createdAt" > now() - interval '30 days')::int AS "last30",
             count(*) FILTER (WHERE "createdAt" > now() - interval '30 days' AND status = 'REGISTERED')::int AS "joined30"
      FROM leads`, [OPEN]);
    return { ...r, open: OPEN.reduce((s, k) => s + r[k], 0), conversion30: r.last30 ? Math.round((r.joined30 / r.last30) * 100) : 0, labels: LEAD_STAGE_LABEL };
  }

  // ------------------------------------------------------------------ detail

  async findOne(id: string) {
    const lead = await this.leads.findOne({ where: { id }, relations: { player: true } });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async detail(id: string) {
    const lead = await this.findOne(id);
    const [timeline, dupes, guardian, trialSession, trialTeam, assigned] = await Promise.all([
      this.ds.query(`SELECT a.id, a.type, a.body, a.meta, a."createdAt" AS at, u."fullName" AS by
                     FROM lead_activities a LEFT JOIN users u ON u.id = a."authorId" WHERE a."leadId" = $1 ORDER BY a."createdAt" DESC`, [id]),
      this.ds.query(`SELECT id, reference, status, "createdAt", "playerName" FROM leads
                     WHERE id <> $1 AND (regexp_replace("guardianMobile", '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g')
                       OR (LOWER("guardianEmail") = LOWER($3) AND $3 IS NOT NULL)) ORDER BY "createdAt" DESC LIMIT 10`,
        [id, lead.guardianMobile, lead.guardianEmail ?? null]),
      lead.existingGuardianId ? this.ds.query(`SELECT g.id, g.reference, g."fullName",
          (SELECT count(*)::int FROM players p WHERE p."guardianId" = g.id AND p."archivedAt" IS NULL) AS children
          FROM guardians g WHERE g.id = $1`, [lead.existingGuardianId]).then((r: any[]) => r[0] ?? null) : null,
      lead.trialSessionId ? this.ds.query(`SELECT s.id, s."startsAt", s."endsAt", l.name AS location FROM sessions s
          LEFT JOIN locations l ON l.id = s."locationId" WHERE s.id = $1`, [lead.trialSessionId]).then((r: any[]) => r[0] ?? null) : null,
      lead.trialTeamId ? this.ds.query(`SELECT id, name, level FROM teams WHERE id = $1`, [lead.trialTeamId]).then((r: any[]) => r[0] ?? null) : null,
      lead.assignedToId ? this.ds.query(`SELECT id, "fullName" FROM users WHERE id = $1`, [lead.assignedToId]).then((r: any[]) => r[0] ?? null) : null,
    ]);
    const evaluations = await this.ds.query(`SELECT e.id, e.recommendation, e.ratings, e.strengths, e."toImprove", e."anotherTrial", e."createdAt",
        u."fullName" AS by, t.name AS "recommendedTeam" FROM lead_evaluations e LEFT JOIN users u ON u.id = e."authorId"
        LEFT JOIN teams t ON t.id = e."recommendedTeamId" WHERE e."leadId" = $1 ORDER BY e."createdAt" DESC`, [id]);
    const [trialCoach] = lead.trialCoachId ? await this.ds.query(`SELECT c.id, u."fullName" AS name FROM coaches c JOIN users u ON u.id = c."userId" WHERE c.id = $1`, [lead.trialCoachId]) : [];
    return { lead, stage: LEAD_STAGE_LABEL[lead.status], timeline, possibleDuplicates: dupes, existingFamily: guardian, trialSession, trialTeam, assignedTo: assigned,
      evaluations, trialCoach: trialCoach ?? null };
  }

  // ------------------------------------------------------------------ intake

  /**
   * A new lead from the website pop-up, a call or a walk-in. Works out the age
   * category from the date of birth, flags a repeat enquiry (same mobile or
   * email) and a family that is already registered.
   */
  async create(input: {
    guardianName: string; guardianEmail?: string | null; guardianMobile: string; playerName: string;
    playerDob?: string | null; source?: LeadSource; sourceDetail?: string | null; isGuardian?: boolean;
    notes?: string | null; trialDate?: string; venueLabel?: string; level?: string; ageGroupLabel?: string; playerGender?: string;
  }, authorId?: string) {
    const mobile = normaliseMobile(input.guardianMobile) ?? input.guardianMobile.trim();
    const email = input.guardianEmail?.trim().toLowerCase() || null;
    const dob = parseDob(input.playerDob ?? null);
    let category = input.ageGroupLabel ?? null;
    if (dob && !category) { try { category = (await this.playersService.placeByDob(dob)).code ?? null; } catch { /* outside the ranges */ } }
    const [dupe] = await this.ds.query(
      `SELECT id FROM leads WHERE regexp_replace("guardianMobile", '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
          OR (LOWER("guardianEmail") = LOWER($2) AND $2 IS NOT NULL) ORDER BY "createdAt" DESC LIMIT 1`, [mobile, email]);
    const [family] = await this.ds.query(
      `SELECT id FROM guardians WHERE regexp_replace(mobile, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
          OR (LOWER(email) = LOWER($2) AND $2 IS NOT NULL) LIMIT 1`, [mobile, email]);
    const lead = await this.leads.save(this.leads.create({
      reference: await this.refs.next('TR'),
      guardianName: input.guardianName.trim(), guardianEmail: email, guardianMobile: mobile,
      playerName: input.playerName.trim(), playerDob: dob ?? undefined, ageGroupLabel: category ?? undefined,
      source: input.source ?? LeadSource.POPUP, sourceDetail: input.sourceDetail ?? null, isGuardian: !!input.isGuardian,
      notes: input.notes ?? undefined, level: input.level, venueLabel: input.venueLabel,
      trialDate: input.trialDate ? new Date(input.trialDate) : undefined,
      playerGender: input.playerGender ?? null,
      duplicateOfLeadId: dupe?.id ?? null, existingGuardianId: family?.id ?? null,
      status: LeadStatus.NEW,
    }));
    await this.log(lead.id, 'CREATED', input.notes ?? null, {
      source: lead.source, duplicateOf: dupe?.id ?? null, existingFamily: family?.id ?? null,
    }, authorId);
    return this.findOne(lead.id);
  }

  async update(id: string, input: Partial<Pick<Lead, 'guardianName' | 'guardianEmail' | 'guardianMobile' | 'playerName' | 'playerDob' | 'source' | 'notes' | 'playerGender'>>, authorId?: string) {
    const lead = await this.findOne(id);
    const patch: any = { ...input };
    if (input.guardianMobile) patch.guardianMobile = normaliseMobile(input.guardianMobile) ?? input.guardianMobile;
    if (input.guardianEmail !== undefined) patch.guardianEmail = input.guardianEmail?.trim().toLowerCase() || null;
    if (input.playerDob) {
      patch.playerDob = parseDob(input.playerDob);
      if (!patch.playerDob) throw new BadRequestException('Date of birth not understood — use DD/MM/YYYY');
      try { patch.ageGroupLabel = (await this.playersService.placeByDob(patch.playerDob)).code ?? null; } catch { /* keep */ }
    }
    await this.leads.update(id, patch);
    const changed = Object.keys(input).filter((k) => (input as any)[k] !== (lead as any)[k]);
    if (changed.length) await this.log(id, 'EDITED', null, { fields: changed }, authorId);
    return this.findOne(id);
  }

  // ------------------------------------------------------------ the pipeline

  async updateStatus(id: string, status: LeadStatus, extra?: { trialDate?: string; notes?: string; reason?: string }, authorId?: string) {
    const lead = await this.findOne(id);
    if (lead.status === LeadStatus.REGISTERED) throw new BadRequestException('Lead already converted to a player');
    if (status === LeadStatus.LOST && !(extra?.reason || extra?.notes)) throw new BadRequestException('Say why they are not joining');
    const patch: any = { status };
    if (extra?.trialDate) patch.trialDate = new Date(extra.trialDate);
    if (extra?.notes) patch.notes = extra.notes;
    if (status === LeadStatus.LOST) { patch.lostReason = extra?.reason || extra?.notes; patch.nextFollowUpAt = null; }
    await this.leads.update(id, patch);
    await this.log(id, status === LeadStatus.LOST ? 'LOST' : 'STATUS', extra?.reason ?? extra?.notes ?? null,
      { from: lead.status, to: status }, authorId);
    return this.findOne(id);
  }

  /** A comment, or a contact attempt (call, WhatsApp, email, SMS), optionally with the next follow-up. */
  async addActivity(id: string, input: { type: string; body?: string; outcome?: string; nextFollowUpAt?: string | null }, authorId?: string) {
    const lead = await this.findOne(id);
    const type = input.type.toUpperCase();
    if (!['COMMENT', ...CONTACT_TYPES].includes(type)) throw new BadRequestException('Unknown activity');
    if (type === 'COMMENT' && !input.body?.trim()) throw new BadRequestException('Write the comment');
    await this.log(id, type, input.body?.trim() || null, input.outcome ? { outcome: input.outcome } : null, authorId);
    const patch: any = {};
    if (CONTACT_TYPES.includes(type)) {
      patch.lastContactedAt = new Date();
      patch.contactAttempts = (lead.contactAttempts ?? 0) + 1;
      if (lead.status === LeadStatus.NEW) {
        patch.status = LeadStatus.CONTACTED;
        await this.log(id, 'STATUS', null, { from: lead.status, to: LeadStatus.CONTACTED, auto: true }, authorId);
      }
    }
    if (input.nextFollowUpAt !== undefined) {
      patch.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
      if (input.nextFollowUpAt) await this.log(id, 'FOLLOW_UP', null, { at: input.nextFollowUpAt }, authorId);
    }
    if (Object.keys(patch).length) await this.leads.update(id, patch);
    return this.detail(id);
  }

  async setFollowUp(id: string, at: string | null, note?: string, authorId?: string) {
    await this.findOne(id);
    await this.leads.update(id, { nextFollowUpAt: at ? new Date(at) : null });
    await this.log(id, 'FOLLOW_UP', note ?? null, { at }, authorId);
    return this.detail(id);
  }

  async assign(id: string, assignedToId: string | null, authorId?: string) {
    await this.findOne(id);
    await this.leads.update(id, { assignedToId: assignedToId ?? undefined } as any);
    if (!assignedToId) await this.ds.query(`UPDATE leads SET "assignedToId" = NULL WHERE id = $1`, [id]);
    const [u] = assignedToId ? await this.ds.query(`SELECT "fullName" FROM users WHERE id = $1`, [assignedToId]) : [null];
    await this.log(id, 'ASSIGNED', u?.fullName ?? 'Unassigned', { to: assignedToId }, authorId);
    return this.findOne(id);
  }

  /**
   * Book the trial into a real training session of a team, so the child shows
   * on that session's register and the coach can mark them.
   */
  async bookTrial(id: string, input: { sessionId: string; note?: string }, authorId?: string) {
    const lead = await this.findOne(id);
    if (lead.status === LeadStatus.REGISTERED) throw new BadRequestException('Already joined');
    const s = await this.sessions.findOne({ where: { id: input.sessionId }, relations: { team: true } });
    if (!s) throw new BadRequestException('Session not found');
    if (s.isCancelled) throw new BadRequestException('That session is cancelled');
    await this.leads.update(id, {
      status: LeadStatus.TRIAL_BOOKED, trialSessionId: s.id, trialTeamId: s.teamId ?? null, trialDate: s.startsAt,
      trialOutcome: null, nextFollowUpAt: s.endsAt, trialConfirmed: false,
      // A Development team's session is a Development trial; Advanced / HPC teams assess for those squads.
      trialType: !s.team || s.team.level === 'DEVELOPMENT' ? 'DEVELOPMENT' : 'ADVANCED',
    });
    await this.log(id, 'TRIAL_BOOKED', input.note ?? null, { sessionId: s.id, team: s.team?.name, at: s.startsAt }, authorId);
    return this.detail(id);
  }

  /** After the trial: attended (→ Trial done) or no-show (→ back to Contacted, follow up tomorrow). */
  async trialResult(id: string, input: { outcome: 'ATTENDED' | 'NO_SHOW'; feedback?: string; recommendedLevel?: string }, authorId?: string) {
    const lead = await this.findOne(id);
    const attended = input.outcome === 'ATTENDED';
    await this.leads.update(id, {
      trialOutcome: input.outcome, trialFeedback: input.feedback ?? null, level: input.recommendedLevel ?? lead.level,
      status: attended ? LeadStatus.TRIAL_ATTENDED : LeadStatus.CONTACTED,
      nextFollowUpAt: new Date(Date.now() + 86400000),
    });
    await this.log(id, 'TRIAL_RESULT', input.feedback ?? null, { outcome: input.outcome, level: input.recommendedLevel ?? null }, authorId);
    return this.detail(id);
  }

  /** Called once the child has been registered through Register a child. */
  async markConverted(id: string, playerId: string, authorId?: string) {
    const lead = await this.findOne(id);
    const [pl] = await this.ds.query(`SELECT id, reference, "firstName", "lastName" FROM players WHERE id = $1`, [playerId]);
    if (!pl) throw new BadRequestException('Player not found');
    await this.leads.update(id, { status: LeadStatus.REGISTERED, playerId: lead.playerId ?? playerId, nextFollowUpAt: null });
    await this.log(id, 'CONVERTED', `${pl.firstName} ${pl.lastName} registered`, { playerId, reference: pl.reference }, authorId);
    return this.detail(id);
  }

  /** Quick conversion without the wizard (kept for the API and older screens). */
  async convert(id: string, input: { gender: Gender; dateOfBirth: string; guardianId?: string }, authorId?: string) {
    const lead = await this.findOne(id);
    if (lead.playerId) throw new BadRequestException('Lead already converted');
    let guardian: Guardian | null = null;
    if (input.guardianId) {
      guardian = await this.guardians.findOne({ where: { id: input.guardianId } });
      if (!guardian) throw new BadRequestException('Invalid guardianId');
    } else {
      guardian = (lead.guardianEmail ? await this.guardians.findOne({ where: { email: lead.guardianEmail.toLowerCase() } }) : null)
        ?? (lead.existingGuardianId ? await this.guardians.findOne({ where: { id: lead.existingGuardianId } }) : null);
      if (!guardian) {
        if (!lead.guardianEmail) throw new BadRequestException('Add the parent\'s email before registering');
        guardian = await this.guardiansService.create({ fullName: lead.guardianName, email: lead.guardianEmail, mobile: lead.guardianMobile });
      }
    }
    const [firstName, ...rest] = lead.playerName.trim().split(' ');
    const player = await this.playersService.create({
      guardianId: guardian.id, firstName, lastName: rest.join(' ') || firstName, gender: input.gender, dateOfBirth: input.dateOfBirth,
    });
    await this.leads.update(id, { status: LeadStatus.REGISTERED, playerId: player.id, nextFollowUpAt: null });
    await this.log(id, 'CONVERTED', `${player.firstName} ${player.lastName} registered`, { playerId: player.id, reference: player.reference }, authorId);
    return {
      lead: await this.findOne(id),
      guardian: { id: guardian.id, reference: guardian.reference },
      player: { id: player.id, reference: player.reference, ageGroup: player.ageGroup?.code },
    };
  }

  /** Trial children booked into a session — shown on its register. */
  trialsForSession(sessionId: string) {
    return this.leads.find({ where: { trialSessionId: sessionId }, order: { playerName: 'ASC' } });
  }

  async funnel() {
    const rows = await this.leads.createQueryBuilder('l').select('l.status', 'status').addSelect('COUNT(*)', 'count').groupBy('l.status').getRawMany();
    const byStatus: Record<string, number> = {};
    rows.forEach((r) => (byStatus[r.status] = Number(r.count)));
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const registered = byStatus[LeadStatus.REGISTERED] || 0;
    return { total, byStatus, conversionRate: total ? Math.round((registered / total) * 100) : 0 };
  }

  /** Staff who can be given leads (anyone with lead permissions), not the built-in admin account. */
  async owners() {
    return this.ds.query(`SELECT DISTINCT u.id, u."fullName" FROM users u JOIN roles r ON r.id = u."roleId"
      LEFT JOIN role_permissions rp ON rp."rolesId" = r.id LEFT JOIN permissions p ON p.id = rp."permissionsId"
      WHERE u."isActive" AND (r.slug = 'super-admin' OR p.key = 'lead.edit')
        AND u.email <> $1 ORDER BY u."fullName"`, [(process.env.SEED_ADMIN_EMAIL || 'admin@laligaacademy.local').toLowerCase()]);
  }

  /** Upcoming sessions a trial can be booked into, for a child's category. */
  async trialSlots(id: string, days = 21) {
    const lead = await this.findOne(id);
    const cat = lead.ageGroupLabel ?? null;
    return this.ds.query(`
      SELECT s.id, s."startsAt", s."endsAt", t.id AS "teamId", t.name AS team, t.level, l.name AS location,
             (SELECT count(*)::int FROM leads x WHERE x."trialSessionId" = s.id) AS "trialsBooked"
      FROM sessions s JOIN teams t ON t.id = s."teamId" LEFT JOIN locations l ON l.id = s."locationId"
      WHERE s.type = 'TRAINING' AND NOT s."isCancelled" AND s."startsAt" > now() AND s."startsAt" < now() + ($1 || ' days')::interval
        AND ($2::text IS NULL OR $2 = ANY(t."ageCodes"))
      ORDER BY s."startsAt", t.name LIMIT 80`, [String(days), cat]);
  }
}
