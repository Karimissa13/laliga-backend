import { PACKAGE_LABEL } from '../finance/pricing';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InvoiceStatus, PlayerStatus, TeamLevel, Weekday } from '../../database/entities';
import {
  PAYMENT_STATE_LABEL, PaymentState, overdueSql, paymentStateSql,
} from '../finance/payment-state';
import { slotLabel } from '../teams/team-label';
import { paginate } from '../../common/dto/pagination.dto';

export interface DirectoryFilter {
  page: number;
  limit: number;
  /** Name (child or parent) or phone number. */
  search?: string;
  playerRef?: string;     // PL-
  guardianRef?: string;   // PR-
  locationId?: string;
  ageGroupId?: string;
  seasonId?: string;
  termId?: string;
  teamId?: string;
  coachId?: string;
  /** A PaymentState, or 'OVERDUE' for anything owed and past due. */
  paymentStatus?: PaymentState | 'OVERDUE';
  /** Registration date range, inclusive, YYYY-MM-DD. */
  registeredFrom?: string;
  registeredTo?: string;
  status?: PlayerStatus;
  includeArchived?: boolean;
}

export interface DirectoryRow {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  name: string;
  dateOfBirth: string;
  gender: string;
  status: PlayerStatus;
  level: TeamLevel | null;
  registeredAt: string;
  archived: boolean;
  guardianId: string;
  guardianReference: string;
  guardianName: string;
  guardianEmail: string;
  guardianMobile: string;
  category: string | null;
  location: string | null;
  team: { id: string; name: string } | null;
  coach: { id: string; name: string } | null;
  days: string;
  term: { id: string; name: string; season: string; package?: string | null } | null;
  payment: {
    state: PaymentState;
    label: string;
    overdue: boolean;
    invoiceNumber: string | null;
    balance: number | null;
  };
  latestComment: { body: string; at: string; author: string | null } | null;
  commentCount: number;
}

/**
 * The player list as the front desk uses it: one row per child, with the parent,
 * placement, schedule, term and payment state already resolved.
 *
 * A read model, written as one parameterised SQL query rather than an ORM
 * traversal, because twelve filters over six joined tables would otherwise mean
 * an N+1 per row. Every user-supplied value is a bound parameter.
 */
@Injectable()
export class PlayerDirectoryService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async list(f: DirectoryFilter) {
    const params: any[] = [];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const where: string[] = [];

    if (!f.includeArchived) where.push(`p."archivedAt" IS NULL`);
    if (f.status) where.push(`p.status = ${p(f.status)}`);

    if (f.search?.trim()) {
      const text = f.search.trim();
      const digits = text.replace(/\D/g, '');
      const like = p(`%${text}%`);
      const ors = [
        `(p."firstName" || ' ' || p."lastName") ILIKE ${like}`,
        `g."fullName" ILIKE ${like}`,
        `g.email ILIKE ${like}`,
      ];
      // Phone search ignores spaces, dashes and the +971 / 0 prefix people type.
      if (digits.length >= 4) {
        const tail = digits.replace(/^(971|0)/, '');
        const d = p(`%${tail}%`);
        ors.push(`regexp_replace(g.mobile, '\\D', '', 'g') LIKE ${d}`);
        ors.push(`regexp_replace(coalesce(p.mobile, ''), '\\D', '', 'g') LIKE ${d}`);
      }
      where.push(`(${ors.join(' OR ')})`);
    }

    // "PL-12", "pl-000012" and "12" all find PL-000012.
    const refFilter = (col: string, raw?: string) => {
      if (!raw?.trim()) return;
      const n = raw.replace(/\D/g, '');
      if (n) where.push(`regexp_replace(${col}, '\\D', '', 'g')::bigint = ${p(Number(n))}`);
      else where.push(`${col} ILIKE ${p(`%${raw.trim()}%`)}`);
    };
    refFilter('p.reference', f.playerRef);
    refFilter('g.reference', f.guardianRef);

    if (f.locationId) where.push(`t."locationId" = ${p(f.locationId)}`);
    if (f.ageGroupId) where.push(`p."ageGroupId" = ${p(f.ageGroupId)}`);
    if (f.teamId) where.push(`p."currentTeamId" = ${p(f.teamId)}`);
    if (f.coachId) where.push(`t."headCoachId" = ${p(f.coachId)}`);
    if (f.seasonId || f.termId) {
      const cond = [`e."playerId" = p.id`, `e.status <> 'CANCELLED'`];
      if (f.seasonId) cond.push(`e."seasonId" = ${p(f.seasonId)}`);
      if (f.termId) cond.push(`e."termId" = ${p(f.termId)}`);
      where.push(`EXISTS (SELECT 1 FROM enrolments e WHERE ${cond.join(' AND ')})`);
    }
    if (f.registeredFrom) where.push(`p."createdAt" >= ${p(f.registeredFrom)}::date`);
    if (f.registeredTo) where.push(`p."createdAt" < (${p(f.registeredTo)}::date + 1)`);

    // Payment is judged on the invoice for the selected term when one is chosen,
    // otherwise on the child's most recent invoice.
    const termScope = f.termId
      ? `AND EXISTS (SELECT 1 FROM enrolments e2 WHERE e2."invoiceId" = i.id AND e2."playerId" = p.id AND e2."termId" = ${p(f.termId)})`
      : '';

    const outer: string[] = [];
    if (f.paymentStatus === 'OVERDUE') outer.push(`d.overdue`);
    else if (f.paymentStatus) outer.push(`d.payment_state = ${p(f.paymentStatus)}`);

    const sql = `
      SELECT d.*, count(*) OVER() AS total_count FROM (
        SELECT
          p.id, p.reference, p."firstName", p."lastName", p."dateOfBirth", p.gender, p.status, p.level,
          p."createdAt" AS registered_at, p."archivedAt" AS archived_at,
          g.id AS g_id, g.reference AS g_ref, g."fullName" AS g_name, g.email AS g_email, g.mobile AS g_mobile,
          ag.code AS category,
          l.name AS location,
          t.id AS t_id, t.name AS t_name, t."trainingDays" AS t_days, t."startTime" AS t_start, t."endTime" AS t_end,
          c.id AS c_id, cu."fullName" AS c_name,
          term.id AS term_id, term.name AS term_name, term.season AS term_season, term.package AS term_package,
          inv.number AS inv_number, inv.status AS inv_status, inv.balance AS inv_balance,
          ${paymentStateSql('inv')} AS payment_state,
          coalesce(${overdueSql('inv')}, false) AS overdue,
          cm.body AS cm_body, cm."createdAt" AS cm_at, cm.author AS cm_author,
          (SELECT count(*) FROM player_comments x WHERE x."playerId" = p.id)::int AS comment_count
        FROM players p
        JOIN guardians g ON g.id = p."guardianId"
        LEFT JOIN age_groups ag ON ag.id = p."ageGroupId"
        LEFT JOIN teams t ON t.id = p."currentTeamId"
        LEFT JOIN locations l ON l.id = t."locationId"
        LEFT JOIN coaches c ON c.id = t."headCoachId"
        LEFT JOIN users cu ON cu.id = c."userId"
        LEFT JOIN LATERAL (
          SELECT tm.id, tm.name, s.name AS season, e.package
          FROM enrolments e JOIN terms tm ON tm.id = e."termId" JOIN seasons s ON s.id = e."seasonId"
          WHERE e."playerId" = p.id AND e.status <> 'CANCELLED'
            ${f.termId ? `AND e."termId" = ${p(f.termId)}` : ''}
          ORDER BY date_trunc('minute', e."enrolledAt") DESC, tm."startDate" ASC LIMIT 1
        ) term ON true
        LEFT JOIN LATERAL (
          SELECT i.number, i.status, i."dueDate",
                 round(i.total - i."amountPaid" + i."amountRefunded" - i."writeOffAmount", 2) AS balance
          FROM invoices i
          JOIN invoice_line_items li ON li."invoiceId" = i.id AND li."playerId" = p.id
          WHERE i.status <> ${p(InvoiceStatus.CANCELLED)} ${termScope}
          ORDER BY i."createdAt" DESC LIMIT 1
        ) inv ON true
        LEFT JOIN LATERAL (
          SELECT x.body, x."createdAt", u."fullName" AS author
          FROM player_comments x LEFT JOIN users u ON u.id = x."authorId"
          WHERE x."playerId" = p.id ORDER BY x."createdAt" DESC LIMIT 1
        ) cm ON true
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ) d
      ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''}
      ORDER BY d.registered_at DESC, d.reference DESC
      LIMIT ${p(f.limit)} OFFSET ${p((f.page - 1) * f.limit)}`;

    const raw: any[] = await this.ds.query(sql, params);
    const total = raw.length ? Number(raw[0].total_count) : 0;
    return paginate(raw.map((r) => this.toRow(r)), total, f.page, f.limit);
  }

  private toRow(r: any): DirectoryRow {
    const state = r.payment_state as PaymentState;
    const days: Weekday[] = this.pgArray(r.t_days);
    return {
      id: r.id,
      reference: r.reference,
      firstName: r.firstName,
      lastName: r.lastName,
      name: `${r.firstName} ${r.lastName}`,
      dateOfBirth: typeof r.dateOfBirth === 'string' ? r.dateOfBirth : new Date(r.dateOfBirth).toISOString().slice(0, 10),
      gender: r.gender,
      status: r.status,
      level: r.level ?? null,
      registeredAt: new Date(r.registered_at).toISOString(),
      archived: !!r.archived_at,
      guardianId: r.g_id,
      guardianReference: r.g_ref,
      guardianName: r.g_name,
      guardianEmail: r.g_email,
      guardianMobile: r.g_mobile,
      category: r.category ?? null,
      location: r.location ?? null,
      team: r.t_id ? { id: r.t_id, name: r.t_name } : null,
      coach: r.c_id ? { id: r.c_id, name: r.c_name } : null,
      days: r.t_id ? slotLabel(days, r.t_start, r.t_end) : '—',
      // The option bought ("Full season"), not just the first of its terms.
      term: r.term_id ? { id: r.term_id, name: (r.term_package && PACKAGE_LABEL[r.term_package as keyof typeof PACKAGE_LABEL]) || r.term_name, season: r.term_season, package: r.term_package ?? null } : null,
      payment: {
        state,
        label: PAYMENT_STATE_LABEL[state] + (r.overdue ? ' · overdue' : ''),
        overdue: !!r.overdue,
        invoiceNumber: r.inv_number ?? null,
        balance: r.inv_balance === null || r.inv_balance === undefined ? null : Number(r.inv_balance),
      },
      latestComment: r.cm_body ? { body: r.cm_body, at: new Date(r.cm_at).toISOString(), author: r.cm_author ?? null } : null,
      commentCount: Number(r.comment_count || 0),
    };
  }

  /** node-postgres returns enum arrays as "{TUE,THU}" strings. */
  private pgArray(v: any): any[] {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
    return [];
  }
}

