import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { InventoryProgramme, StockMovementType } from './enums';

/**
 * One stock-keeping unit: an item in one size. Its SKU is the unified number
 * written on the shelf / box and used for every movement, e.g. LL-004-M.
 * Items that differ only by size share an item code (LL-MATCH-2024-B).
 */
@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() sku: string;
  @Index() @Column() itemCode: string;
  @Column() name: string;
  @Index() @Column({ type: 'enum', enum: InventoryProgramme, default: InventoryProgramme.LALIGA }) programme: InventoryProgramme;
  @Index() @Column() category: string;
  @Column({ type: 'varchar', nullable: true }) size?: string | null;
  @Column({ default: 'Pcs' }) unit: string;
  @Column({ default: 'New' }) condition: string;
  /** Kept equal to the sum of its movements; never typed in directly. */
  @Column({ type: 'int', default: 0 }) currentStock: number;
  @Column({ type: 'int', nullable: true }) minLevel?: number | null;
  /** Where it is in the store — box / shelf numbers. */
  @Column({ type: 'varchar', nullable: true }) location?: string | null;
  @Column({ type: 'text', nullable: true }) notes?: string | null;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/** Every change to stock, in or out. History is never edited — a mistake is corrected by another movement. */
@Entity('inventory_movements')
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) itemId: string;
  @ManyToOne(() => InventoryItem) @JoinColumn({ name: 'itemId' }) item: InventoryItem;
  @Index() @Column({ type: 'enum', enum: StockMovementType }) type: StockMovementType;
  /** Signed: positive into the store, negative out of it. */
  @Column({ type: 'int' }) quantity: number;
  @Column({ type: 'int' }) balanceAfter: number;
  @Index() @Column({ type: 'date' }) movedOn: string;
  /** Who it was given to / received from (person, team, supplier, event). */
  @Column({ type: 'varchar', nullable: true }) party?: string | null;
  @Column({ type: 'varchar', nullable: true }) reason?: string | null;
  /** A delivery note, invoice number or event name. */
  @Column({ type: 'varchar', nullable: true }) reference?: string | null;
  @Column({ type: 'uuid', nullable: true }) playerId?: string | null;
  /** Movements entered together share a batch number (one stock-in note, one handout). */
  @Index() @Column({ type: 'varchar', nullable: true }) batch?: string | null;
  @Column({ type: 'uuid', nullable: true }) recordedById?: string | null;
  @CreateDateColumn() createdAt: Date;
}
