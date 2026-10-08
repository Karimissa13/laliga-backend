import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Attendance, AttendanceStatus, Document, DocumentType, Enrolment, Evaluation, Player,
} from '../../database/entities';

/** The four LaLiga pillars used as the default evaluation scorecard. */
export const EVALUATION_CRITERIA = ['technical', 'tactical', 'physical', 'social'] as const;

@Injectable()
export class DevelopmentService {
  constructor(
    @InjectRepository(Evaluation) private readonly evaluations: Repository<Evaluation>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Attendance) private readonly attendances: Repository<Attendance>,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
  ) {}

  // ------------------------------------------------------- evaluations
  /** Cross-player list — the view the legacy system never had (it was per-player only). */
  list(filter: { playerId?: string; coachId?: string; termId?: string } = {}) {
    const where: any = {};
    if (filter.playerId) where.playerId = filter.playerId;
    if (filter.coachId) where.coachId = filter.coachId;
    if (filter.termId) where.termId = filter.termId;
    return this.evaluations.find({
      where,
      relations: { player: true, term: true, coach: { user: true } },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async create(input: {
    playerId: string; termId?: string; coachId?: string; evaluatorId?: string;
    scores?: Record<string, number>; notes?: string; isCustom?: boolean;
  }) {
    const player = await this.players.findOne({ where: { id: input.playerId } });
    if (!player) throw new BadRequestException('Invalid playerId');
    if (input.scores) {
      for (const [k, v] of Object.entries(input.scores)) {
        if (typeof v !== 'number' || v < 1 || v > 5) {
          throw new BadRequestException(`Score "${k}" must be a number between 1 and 5`);
        }
      }
    }
    const saved = await this.evaluations.save(this.evaluations.create(input));
    return this.evaluations.findOne({
      where: { id: saved.id },
      relations: { player: true, term: true, coach: { user: true } },
    });
  }

  /**
   * The Player Passport: identity, enrolment history, attendance, evaluation
   * trend and documents in one payload. The legacy data existed but was buried.
   */
  async passport(playerId: string) {
    const player = await this.players.findOne({
      where: { id: playerId },
      relations: { guardian: true, ageGroup: true, currentTeam: true },
    });
    if (!player) throw new NotFoundException('Player not found');

    const [evaluations, enrolments, marks, docs] = await Promise.all([
      this.evaluations.find({
        where: { playerId }, relations: { term: true, coach: { user: true } },
        order: { createdAt: 'ASC' },
      }),
      this.enrolments.find({
        where: { playerId }, relations: { season: true, term: true, team: true },
        order: { enrolledAt: 'DESC' },
      }),
      this.attendances.find({ where: { playerId }, relations: { session: true } }),
      this.documents.find({ where: { playerId } }),
    ]);

    // average score per criterion across evaluations, plus a trend series
    const totals: Record<string, { sum: number; n: number }> = {};
    const trend = evaluations.map((e) => {
      const scores = (e.scores || {}) as Record<string, number>;
      for (const [k, v] of Object.entries(scores)) {
        if (typeof v !== 'number') continue;
        totals[k] = totals[k] || { sum: 0, n: 0 };
        totals[k].sum += v; totals[k].n++;
      }
      const vals = Object.values(scores).filter((v) => typeof v === 'number') as number[];
      return {
        date: e.createdAt, term: e.term?.name, coach: e.coach?.user?.fullName,
        scores, overall: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null,
      };
    });
    const averages: Record<string, number> = {};
    for (const [k, v] of Object.entries(totals)) averages[k] = Math.round((v.sum / v.n) * 10) / 10;

    const present = marks.filter((m) => m.status === AttendanceStatus.PRESENT || m.status === AttendanceStatus.LATE).length;

    const requiredDocs = [DocumentType.PHOTO, DocumentType.MEDICAL_INSURANCE, DocumentType.EMIRATES_ID_FRONT];
    const held = new Set(docs.map((d) => d.type));
    const now = new Date();

    return {
      player: {
        id: player.id, reference: player.reference,
        name: `${player.firstName} ${player.lastName}`,
        dateOfBirth: player.dateOfBirth, gender: player.gender,
        ageGroup: player.ageGroup?.code, status: player.status,
        team: player.currentTeam?.name ?? null,
        guardian: player.guardian ? { name: player.guardian.fullName, email: player.guardian.email, mobile: player.guardian.mobile } : null,
        emergencyContact: player.emergencyContactName
          ? { name: player.emergencyContactName, phone: player.emergencyContactPhone } : null,
      },
      development: {
        evaluationCount: evaluations.length,
        averages,
        overall: Object.values(averages).length
          ? Math.round((Object.values(averages).reduce((a, b) => a + b, 0) / Object.values(averages).length) * 10) / 10
          : null,
        trend,
      },
      attendance: {
        sessions: marks.length, present,
        rate: marks.length ? Math.round((present / marks.length) * 100) : null,
      },
      history: enrolments.map((e) => ({
        season: e.season?.name, term: e.term?.name, team: e.team?.name,
        status: e.status, enrolledAt: e.enrolledAt, endedAt: e.endedAt,
      })),
      documents: {
        held: docs.map((d) => ({ id: d.id, type: d.type, fileName: d.fileName, expiresAt: d.expiresAt })),
        missing: requiredDocs.filter((t) => !held.has(t)),
        expired: docs.filter((d) => d.expiresAt && new Date(d.expiresAt) < now).map((d) => d.type),
        complete: requiredDocs.every((t) => held.has(t)),
      },
    };
  }

  // --------------------------------------------------------- documents
  /**
   * Register a document against a player/guardian. Binary storage is delegated
   * to object storage (S3-compatible); this records the metadata and expiry.
   * REQUIRED CONFIG for live uploads: STORAGE_BUCKET, STORAGE_REGION,
   * STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY.
   */
  registerDocument(input: {
    type: DocumentType; fileName: string; storageKey: string; mimeType?: string;
    sizeBytes?: number; expiresAt?: string; playerId?: string; guardianId?: string; uploadedById?: string;
  }) {
    return this.documents.save(this.documents.create({
      ...input,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    }));
  }

  listDocuments(filter: { playerId?: string; guardianId?: string }) {
    const where: any = {};
    if (filter.playerId) where.playerId = filter.playerId;
    if (filter.guardianId) where.guardianId = filter.guardianId;
    return this.documents.find({ where, order: { createdAt: 'DESC' } });
  }

  async removeDocument(id: string) {
    await this.documents.delete(id);
    return { success: true, id };
  }

  /** Documents expiring soon or already expired — a dashboard alert. */
  async expiringDocuments(days = 30) {
    const horizon = new Date(); horizon.setDate(horizon.getDate() + days);
    const docs = await this.documents.find({ relations: { player: true, guardian: true } });
    return docs
      .filter((d) => d.expiresAt && new Date(d.expiresAt) <= horizon)
      .map((d) => ({
        id: d.id, type: d.type, fileName: d.fileName, expiresAt: d.expiresAt,
        expired: new Date(d.expiresAt!) < new Date(),
        player: d.player ? `${d.player.firstName} ${d.player.lastName}` : null,
        guardian: d.guardian?.fullName ?? null,
      }))
      .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime());
  }
}
