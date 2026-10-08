import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { ProgramType, Squad, TeamLevel, Weekday } from './enums';
import { Coach } from './people.entities';

@Entity('seasons')
export class Season {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  @Column({ type: 'date', nullable: true }) startDate?: string;
  @Column({ type: 'date', nullable: true }) endDate?: string;
  @Column({ type: 'date', nullable: true }) cutoffDate?: string;
  @Column({ default: false }) isActive: boolean;
  @OneToMany(() => Term, (t) => t.season) terms: Term[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('terms')
export class Term {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() seasonId: string;
  @ManyToOne(() => Season, (s) => s.terms)
  @JoinColumn({ name: 'seasonId' })
  season: Season;
  @Column() name: string;
  @Column({ type: 'enum', enum: ProgramType, default: ProgramType.TERM }) type: ProgramType;
  @Column({ type: 'date', nullable: true }) startDate?: string;
  @Column({ type: 'date', nullable: true }) endDate?: string;
  @Column({ type: 'int', nullable: true }) weeks?: number;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('locations')
export class Location {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  @Column({ default: 'Abu Dhabi' }) emirate: string;
  @Column({ default: true }) isActive: boolean;
  @OneToMany(() => Venue, (v) => v.location) venues: Venue[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('venues')
export class Venue {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() locationId: string;
  @ManyToOne(() => Location, (l) => l.venues)
  @JoinColumn({ name: 'locationId' })
  location: Location;
  @Column() name: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('age_groups')
export class AgeGroup {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  @Index({ unique: true }) @Column() code: string;
  @Column({ type: 'int', nullable: true }) minBirthYear?: number;
  @Column({ type: 'int', nullable: true }) maxBirthYear?: number;
  @Column({ nullable: true }) level?: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Index() @Column({ nullable: true }) seasonId?: string;
  @ManyToOne(() => Season, { nullable: true })
  @JoinColumn({ name: 'seasonId' })
  season?: Season;
  @Index() @Column({ nullable: true }) ageGroupId?: string;
  @ManyToOne(() => AgeGroup, { nullable: true })
  @JoinColumn({ name: 'ageGroupId' })
  ageGroup?: AgeGroup;
  @Column({ nullable: true }) locationId?: string;
  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'locationId' })
  location?: Location;
  @Column({ nullable: true }) headCoachId?: string;
  @ManyToOne(() => Coach, { nullable: true })
  @JoinColumn({ name: 'headCoachId' })
  headCoach?: Coach;
  @Column({ type: 'int', default: 20 }) capacity: number;

  /** Development / Advanced / HPC. Level belongs to the team, not the age group. */
  @Index() @Column({ type: 'enum', enum: TeamLevel, default: TeamLevel.DEVELOPMENT }) level: TeamLevel;
  /** WHITE = 2nd team, BLUE = 3rd. Null when it is the only team at its level. */
  @Column({ type: 'enum', enum: Squad, nullable: true }) squad?: Squad | null;
  /** Distinguishes parallel teams at the same level, e.g. U8 Development 1 and 2. */
  @Column({ type: 'int', nullable: true }) squadNumber?: number | null;
  /**
   * Every age category this team takes, as codes. Usually just its own
   * (['U12']); a combined team such as U16/18 Development lists both.
   */
  @Column({ type: 'text', array: true, default: () => "'{}'" }) ageCodes: string[];
  @Column({ type: 'enum', enum: Weekday, array: true, default: '{}' }) trainingDays: Weekday[];
  @Column({ type: 'time', nullable: true }) startTime?: string | null;
  @Column({ type: 'time', nullable: true }) endTime?: string | null;
  /** A girls-only squad is priced from the Girls row of the price list. */
  @Column({ default: false }) girlsOnly: boolean;

  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
