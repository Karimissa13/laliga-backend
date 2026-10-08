import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, Unique,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { AttendanceStatus, SessionType } from './enums';
import { Term, Team, Location, Venue } from './structure.entities';
import { Coach, Player } from './people.entities';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true }) title?: string;
  @Column({ type: 'enum', enum: SessionType, default: SessionType.TRAINING }) type: SessionType;
  @Column({ nullable: true }) termId?: string;
  @ManyToOne(() => Term, { nullable: true }) @JoinColumn({ name: 'termId' }) term?: Term;
  @Index() @Column({ nullable: true }) teamId?: string;
  @ManyToOne(() => Team, { nullable: true }) @JoinColumn({ name: 'teamId' }) team?: Team;
  @Column({ nullable: true }) locationId?: string;
  @ManyToOne(() => Location, { nullable: true }) @JoinColumn({ name: 'locationId' }) location?: Location;
  @Column({ nullable: true }) venueId?: string;
  @ManyToOne(() => Venue, { nullable: true }) @JoinColumn({ name: 'venueId' }) venue?: Venue;
  @Column({ nullable: true }) coachId?: string;
  @ManyToOne(() => Coach, { nullable: true }) @JoinColumn({ name: 'coachId' }) coach?: Coach;
  @Index() @Column({ type: 'timestamptz' }) startsAt: Date;
  @Column({ type: 'timestamptz' }) endsAt: Date;
  /** Called off (weather, pitch closed …). Kept for the record; left out of attendance rates. */
  @Column({ default: false }) isCancelled: boolean;
  @Column({ type: 'varchar', nullable: true }) cancelReason?: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('attendances')
@Unique(['sessionId', 'playerId'])
export class Attendance {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() sessionId: string;
  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;
  @Index() @Column() playerId: string;
  @ManyToOne(() => Player)
  @JoinColumn({ name: 'playerId' })
  player: Player;
  @Column({ type: 'enum', enum: AttendanceStatus, default: AttendanceStatus.PRESENT })
  status: AttendanceStatus;
  @Column({ nullable: true }) reason?: string;
  @Column({ nullable: true }) comment?: string;
  @CreateDateColumn() recordedAt: Date;
}
