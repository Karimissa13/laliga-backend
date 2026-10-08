import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany,
  OneToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { CoachEmployment, Gender, LeadSource, PlayerStatus, TeamLevel } from './enums';
import { User } from './auth.entities';

@Entity('guardians')
export class Guardian {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() reference: string; // PR-000001
  @Column() fullName: string;
  @Column({ nullable: true }) relationship?: string;
  @Index({ unique: true }) @Column() email: string;
  /** Another family member's email (e.g. the other parent). Copied on invoice emails. */
  @Column({ type: 'varchar', nullable: true }) secondaryEmail?: string | null;
  /** Whose the additional email is, e.g. "Mother — Rana". */
  @Column({ type: 'varchar', length: 120, nullable: true }) secondaryEmailName?: string | null;
  @Index() @Column() mobile: string;
  @Column({ nullable: true, select: false }) passwordHash?: string;
  /** Parent sign-in: a temporary password must be changed at first sign-in. */
  @Column({ default: false }) mustChangePassword: boolean;
  @Column({ type: 'timestamptz', nullable: true }) tempPasswordExpiresAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) credentialsSentAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt?: Date | null;
  @Column({ nullable: true }) emirate?: string;
  @Column({ nullable: true }) city?: string;
  @Column({ type: 'enum', enum: LeadSource, nullable: true }) howHeard?: LeadSource;
  @Column({ default: false }) marketingConsent: boolean;
  @Column({ default: true }) isActive: boolean;
  /**
   * Optional admin override for sibling-discount order, as an ordered list of
   * player ids: first in the list pays full price, the rest take the ladder.
   * Null means the default rule (eldest pays full, discount runs down to the
   * youngest). Set deliberately and audited — see DiscountEngine.siblingPlan().
   */
  @Column({ type: 'jsonb', nullable: true }) siblingRankOverride?: string[];
  @OneToMany(() => Player, (p) => p.guardian) players: Player[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('players')
export class Player {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() reference: string; // PL-000001
  @Index() @Column() guardianId: string;
  @ManyToOne(() => Guardian, (g) => g.players)
  @JoinColumn({ name: 'guardianId' })
  guardian: Guardian;
  @Column() firstName: string;
  @Column() lastName: string;
  @Column({ type: 'enum', enum: Gender }) gender: Gender;
  @Column({ type: 'date' }) dateOfBirth: string;
  @Column({ nullable: true }) email?: string;
  @Column({ nullable: true }) mobile?: string;
  @Index() @Column({ type: 'enum', enum: PlayerStatus, default: PlayerStatus.TRIAL })
  status: PlayerStatus;
  @Index() @Column({ nullable: true }) ageGroupId?: string;
  @ManyToOne('AgeGroup', { nullable: true })
  @JoinColumn({ name: 'ageGroupId' })
  ageGroup?: any;
  @Column({ default: false }) ageGroupOverride: boolean;
  /**
   * Level the child was placed at. Normally the level of their team; kept on the
   * player too so a waitlisted child with no team still has one.
   */
  @Column({ type: 'enum', enum: TeamLevel, nullable: true }) level?: TeamLevel | null;
  /** When the child was archived, by whom, and why — "delete" never destroys history. */
  @Column({ type: 'timestamptz', nullable: true }) archivedAt?: Date | null;
  @Column({ type: 'text', nullable: true }) archiveReason?: string | null;
  @Index() @Column({ nullable: true }) currentTeamId?: string;
  @ManyToOne('Team', { nullable: true })
  @JoinColumn({ name: 'currentTeamId' })
  currentTeam?: any;
  @Column({ nullable: true }) kitSize?: string;
  @Column({ nullable: true }) previousAcademy?: string;
  @Column({ nullable: true }) emergencyContactName?: string;
  @Column({ nullable: true }) emergencyContactPhone?: string;
  @Column({ type: 'text', nullable: true }) medicalNotes?: string;
  @OneToMany(() => PlayerComment, (c) => c.player) comments: PlayerComment[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('player_comments')
export class PlayerComment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() playerId: string;
  @ManyToOne(() => Player, (p) => p.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;
  @Column({ nullable: true }) authorId?: string;
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'authorId' })
  author?: User;
  @Column({ type: 'text' }) body: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('coaches')
export class Coach {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() userId: string;
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
  @Column({ nullable: true }) certification?: string;
  @Column({ type: 'text', nullable: true }) bio?: string;
  /** Full-time or part-time. Null until operations sets it — the dashboard says "not set" rather than guess. */
  @Column({ type: 'enum', enum: CoachEmployment, nullable: true }) employmentType?: CoachEmployment | null;
  /** Small profile photo as a data: URL (the admin UI's CSP only allows self and data: images). */
  @Column({ type: 'text', nullable: true }) photoUrl?: string | null;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
