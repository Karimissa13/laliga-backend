import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import {
  CommunicationChannel, CommunicationStatus, DocumentType,
} from './enums';
import { Guardian, Player, Coach } from './people.entities';
import { Term } from './structure.entities';
import { User } from './auth.entities';

@Entity('evaluations')
export class Evaluation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() playerId: string;
  @ManyToOne(() => Player) @JoinColumn({ name: 'playerId' }) player: Player;
  @Column({ nullable: true }) termId?: string;
  @ManyToOne(() => Term, { nullable: true }) @JoinColumn({ name: 'termId' }) term?: Term;
  @Column({ nullable: true }) coachId?: string;
  @ManyToOne(() => Coach, { nullable: true }) @JoinColumn({ name: 'coachId' }) coach?: Coach;
  @Column({ nullable: true }) evaluatorId?: string;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'evaluatorId' }) evaluator?: User;
  @Column({ default: false }) isCustom: boolean;
  /** Item scores. Term reports key them "area.item" (e.g. "technical.ball_skills"). */
  @Column({ type: 'jsonb', nullable: true }) scores?: Record<string, any>;
  /** Development: the coach's observations. Advanced: the general comment. */
  @Column({ type: 'text', nullable: true }) notes?: string;
  /** DEVELOPMENT or ADVANCED term report; null for the older four-pillar scorecard. */
  @Index() @Column({ type: 'varchar', length: 12, nullable: true }) reportType?: string | null;
  @Column({ type: 'uuid', nullable: true }) seasonId?: string | null;
  @Index() @Column({ type: 'uuid', nullable: true }) teamId?: string | null;
  /** DRAFT while the coach works on it, FINAL once locked (only a super admin can reopen). */
  @Column({ type: 'varchar', length: 10, default: 'DRAFT' }) status: string;
  /** Advanced: one comment per area. */
  @Column({ type: 'jsonb', nullable: true }) comments?: Record<string, string> | null;
  /** Development: up to two positions on the pitch (GK, RB, CB1 …). */
  @Column({ type: 'jsonb', nullable: true }) positions?: string[] | null;
  /** Advanced: GOALKEEPER, DEFENDER, MIDFIELDER or FORWARD — picks the report's items. */
  @Column({ type: 'varchar', length: 12, nullable: true }) position?: string | null;
  @Column({ type: 'int', nullable: true }) shirtNumber?: number | null;
  /** Advanced: the player's photo, a small JPEG data URL. */
  @Column({ type: 'text', nullable: true }) photo?: string | null;
  @Column({ type: 'timestamptz', nullable: true }) finalizedAt?: Date | null;
  @Column({ type: 'uuid', nullable: true }) finalizedById?: string | null;
  @Column({ type: 'timestamptz', nullable: true }) sentAt?: Date | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'enum', enum: DocumentType }) type: DocumentType;
  @Column() fileName: string;
  @Column() storageKey: string;
  @Column({ nullable: true }) mimeType?: string;
  @Column({ type: 'int', nullable: true }) sizeBytes?: number;
  @Column({ type: 'timestamptz', nullable: true }) expiresAt?: Date;
  @Index() @Column({ nullable: true }) playerId?: string;
  @ManyToOne(() => Player, { nullable: true }) @JoinColumn({ name: 'playerId' }) player?: Player;
  @Index() @Column({ nullable: true }) guardianId?: string;
  @ManyToOne(() => Guardian, { nullable: true }) @JoinColumn({ name: 'guardianId' }) guardian?: Guardian;
  @Column({ nullable: true }) uploadedById?: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('communication_templates')
export class CommunicationTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  @Column({ type: 'enum', enum: CommunicationChannel }) channel: CommunicationChannel;
  @Column({ nullable: true }) subject?: string;
  @Column({ type: 'text' }) body: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('communications')
export class Communication {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'enum', enum: CommunicationChannel }) channel: CommunicationChannel;
  @Index() @Column({ type: 'enum', enum: CommunicationStatus, default: CommunicationStatus.QUEUED })
  status: CommunicationStatus;
  @Column({ nullable: true }) templateId?: string;
  @ManyToOne(() => CommunicationTemplate, { nullable: true })
  @JoinColumn({ name: 'templateId' })
  template?: CommunicationTemplate;
  @Index() @Column({ nullable: true }) guardianId?: string;
  @ManyToOne(() => Guardian, { nullable: true }) @JoinColumn({ name: 'guardianId' }) guardian?: Guardian;
  @Column() toAddress: string;
  @Column({ nullable: true }) subject?: string;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'timestamptz', nullable: true }) sentAt?: Date;
  @Column({ nullable: true }) error?: string;
  /** Why it was sent: welcome, invoice, broadcast … */
  @Column({ type: 'varchar', nullable: true }) kind?: string | null;
  /** Attachments by reference (e.g. {type:'invoice', id}) — regenerated on demand, never stored as files. */
  @Column({ type: 'jsonb', nullable: true }) attachments?: Array<{ type: string; id: string; fileName: string }> | null;
  /** True when no mail server is connected yet and the message was only recorded. */
  @Column({ default: false }) simulated: boolean;
  @CreateDateColumn() createdAt: Date;
}
