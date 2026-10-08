import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, JoinTable, ManyToMany,
  ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() key: string; // module.action
  @Index() @Column() module: string;
  @Column() action: string;
  @Column({ nullable: true }) description?: string;
  @ManyToMany(() => Role, (r) => r.permissions) roles: Role[];
}

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  @Index({ unique: true }) @Column() slug: string;
  @Column({ nullable: true }) description?: string;
  @Column({ default: false }) isSystem: boolean;
  @ManyToMany(() => Permission, (p) => p.roles, { cascade: false })
  @JoinTable({ name: 'role_permissions' })
  permissions: Permission[];
  @OneToMany(() => User, (u) => u.role) users: User[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() fullName: string;
  @Index({ unique: true }) @Column() email: string;
  @Column({ nullable: true }) mobile?: string;
  @Column({ select: false }) passwordHash: string;
  @Column({ default: true }) isActive: boolean;
  @Column({ nullable: true, select: false }) twoFactorSecret?: string;
  @Column({ default: false }) twoFactorEnabled: boolean;
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt?: Date;
  @Index() @Column() roleId: string;
  @ManyToOne(() => Role, (r) => r.users, { eager: true })
  @JoinColumn({ name: 'roleId' })
  role: Role;
  @OneToOne('Coach', 'user') coach?: any;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
  @Index({ unique: true }) @Column() tokenHash: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt?: Date;
  @CreateDateColumn() createdAt: Date;
}

@Entity('audit_logs')
@Index(['entity', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ nullable: true }) actorId?: string;
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor?: User;
  @Column({ default: 'user' }) actorType: string;
  @Index() @Column() action: string;
  @Column({ nullable: true }) entity?: string;
  @Column({ nullable: true }) entityId?: string;
  @Column({ nullable: true }) ipAddress?: string;
  @Column({ nullable: true }) userAgent?: string;
  @Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, any>;
  @Index() @CreateDateColumn() createdAt: Date;
}
