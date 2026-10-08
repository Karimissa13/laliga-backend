import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { EnrolmentStatus, LeadSource, LeadStatus } from './enums';
import { Player } from './people.entities';
import { Season, Term, Team } from './structure.entities';
import { Invoice } from './finance.entities';

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() reference: string; // TR-000001
  @Column() guardianName: string;
  /** Optional on the website's trial form. */
  @Column({ type: 'varchar', nullable: true }) guardianEmail?: string | null;
  @Column() guardianMobile: string;
  @Column() playerName: string;
  @Column({ type: 'date', nullable: true }) playerDob?: string;
  @Column({ nullable: true }) ageGroupLabel?: string;
  @Column({ nullable: true }) level?: string;
  @Index() @Column({ type: 'enum', enum: LeadSource, default: LeadSource.ENQUIRY })
  source: LeadSource;
  @Index() @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.NEW })
  status: LeadStatus;
  @Column({ type: 'timestamptz', nullable: true }) trialDate?: Date;
  @Column({ nullable: true }) venueLabel?: string;
  @Column({ default: true }) interested: boolean;
  @Column({ nullable: true }) assignedToId?: string;
  @Column({ type: 'text', nullable: true }) notes?: string;
  @Column({ nullable: true }) playerId?: string;
  @OneToOne(() => Player, { nullable: true })
  @JoinColumn({ name: 'playerId' })
  player?: Player;

  /** The parent ticked "I'm the player's parent or guardian" on the form. */
  @Column({ default: false }) isGuardian: boolean;
  /** Gender, when known (the website form does not ask). */
  @Column({ type: 'varchar', length: 8, nullable: true }) playerGender?: string | null;
  /** The team and session the trial is booked into. */
  @Column({ type: 'uuid', nullable: true }) trialTeamId?: string | null;
  @Column({ type: 'uuid', nullable: true }) trialSessionId?: string | null;
  /** ATTENDED, NO_SHOW or ANOTHER_TRIAL (came, but the coach wants to see them again). */
  @Column({ type: 'varchar', length: 16, nullable: true }) trialOutcome?: string | null;
  /** Development trial or Advanced trial (assessment for an Advanced / HPC team). */
  @Column({ type: 'varchar', length: 12, nullable: true }) trialType?: string | null;
  /** The parent confirmed they are coming. */
  @Column({ default: false }) trialConfirmed: boolean;
  /** The coach who ran the trial. */
  @Column({ type: 'uuid', nullable: true }) trialCoachId?: string | null;
  /** The coach's call: DEVELOPMENT, ADVANCED, HPC or ADV_INVITE (invited to the Advanced trials). */
  @Column({ type: 'varchar', length: 12, nullable: true }) trialEvaluation?: string | null;
  /** Where the follow-up after the trial stands, from the desk's standard list. */
  @Column({ type: 'varchar', length: 200, nullable: true }) followUpOutcome?: string | null;
  @Column({ type: 'text', nullable: true }) trialFeedback?: string | null;
  /** When someone should next get back to this family. */
  @Index() @Column({ type: 'timestamptz', nullable: true }) nextFollowUpAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) lastContactedAt?: Date | null;
  @Column({ type: 'int', default: 0 }) contactAttempts: number;
  @Column({ type: 'varchar', nullable: true }) lostReason?: string | null;
  /** Same mobile or email as an earlier lead, or a family already on file. */
  @Column({ type: 'uuid', nullable: true }) duplicateOfLeadId?: string | null;
  @Column({ type: 'uuid', nullable: true }) existingGuardianId?: string | null;
  /** Where on the website it came from (page / campaign), as sent by the form. */
  @Column({ type: 'varchar', nullable: true }) sourceDetail?: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/** Everything that happened with a lead, newest first on screen: comments, calls, messages, trial, status. */
@Entity('lead_activities')
export class LeadActivity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) leadId: string;
  @ManyToOne(() => Lead, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'leadId' }) lead: Lead;
  /** CREATED, COMMENT, CALL, WHATSAPP, EMAIL, SMS, STATUS, TRIAL_BOOKED, TRIAL_RESULT, FOLLOW_UP, ASSIGNED, CONVERTED, LOST */
  @Index() @Column({ type: 'varchar', length: 20 }) type: string;
  @Column({ type: 'text', nullable: true }) body?: string | null;
  @Column({ type: 'jsonb', nullable: true }) meta?: Record<string, any> | null;
  @Column({ type: 'uuid', nullable: true }) authorId?: string | null;
  @CreateDateColumn() createdAt: Date;
}

/** A coach's evaluation of a child at their trial. */
@Entity('lead_evaluations')
export class LeadEvaluation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) leadId: string;
  @ManyToOne(() => Lead, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'leadId' }) lead: Lead;
  @Column({ type: 'uuid', nullable: true }) authorId?: string | null;
  @Column({ type: 'uuid', nullable: true }) coachId?: string | null;
  /** DEVELOPMENT, ADVANCED, HPC, ADV_INVITE or NOT_READY */
  @Column({ type: 'varchar', length: 12 }) recommendation: string;
  /** 1–5 for technical, tactical, physical, attitude. */
  @Column({ type: 'jsonb', nullable: true }) ratings?: Record<string, number> | null;
  @Column({ type: 'text', nullable: true }) strengths?: string | null;
  @Column({ type: 'text', nullable: true }) toImprove?: string | null;
  @Column({ type: 'uuid', nullable: true }) recommendedTeamId?: string | null;
  @Column({ default: false }) anotherTrial: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('enrolments')
export class Enrolment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() playerId: string;
  @ManyToOne(() => Player)
  @JoinColumn({ name: 'playerId' })
  player: Player;
  @Index() @Column() seasonId: string;
  @ManyToOne(() => Season)
  @JoinColumn({ name: 'seasonId' })
  season: Season;
  @Index() @Column() termId: string;
  @ManyToOne(() => Term)
  @JoinColumn({ name: 'termId' })
  term: Term;
  @Index() @Column({ nullable: true }) teamId?: string;
  @ManyToOne(() => Team, { nullable: true })
  @JoinColumn({ name: 'teamId' })
  team?: Team;
  @Column({ type: 'enum', enum: EnrolmentStatus, default: EnrolmentStatus.PENDING })
  status: EnrolmentStatus;
  @Column({ type: 'timestamptz', default: () => 'now()' }) enrolledAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt?: Date;
  /**
   * Sessions a week the family is paying for (1, 2 or 3 — the price-list tier).
   * Null on older enrolments; pricing then falls back to the team's training days.
   */
  @Column({ type: 'int', nullable: true }) sessionsPerWeek?: number | null;
  /** Which term option was bought (T1 … FULL); every enrolment of one purchase shares it. */
  @Column({ type: 'varchar', length: 8, nullable: true }) package?: string | null;
  /**
   * The day the child starts training, when it is after the term's first day.
   * The training fee is prorated from it (sessions left ÷ sessions in the purchase).
   * Null = from the first day of the term (full price).
   */
  @Column({ type: 'date', nullable: true }) startDate?: string | null;
  @Column({ nullable: true }) invoiceId?: string;
  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: Invoice;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
