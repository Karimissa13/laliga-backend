import { TEST_ITEM } from './practice-item';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  InventoryItem, InventoryMovement, InventoryProgramme, StockMovementType,
} from '../../database/entities';

const PREFIX: Record<InventoryProgramme, string> = { LALIGA: 'LL', ADSC: 'ADSC' };

/** "7-8" → "78", "13-14" → "1314", "XL" → "XL", none → "OS" (one size). */
export function sizeCode(size?: string | null): string {
  const s = String(size ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s || 'OS';
}

const LETTER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL'];
/** Children's numeric sizes first (6, 8, 10 …, 7-8, 9-10), then S, M, L, XL; one-size last. */
export function sizeRank(size?: string | null): number {
  const s = String(size ?? '').trim().toUpperCase();
  if (!s) return 9999;
  const n = parseInt(s, 10);
  if (!Number.isNaN(n)) return n;
  const i = LETTER.indexOf(s);
  return i >= 0 ? 1000 + i : 5000;
}

export interface MovementLine { itemId?: string; sku?: string; quantity: number; countedQty?: number }

/**
 * The store. Every item in every size has one unified number (its SKU, e.g.
 * LL-004-M); stock only changes through movements — in, out, or a stock-take
 * adjustment — and each movement records who, why and the balance after it.
 * LaLiga and ADSC stock are kept apart by programme.
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(InventoryItem) private readonly items: Repository<InventoryItem>,
    @InjectRepository(InventoryMovement) private readonly moves: Repository<InventoryMovement>,
  ) {}

  private status(i: { currentStock: number; minLevel?: number | null }) {
    if (i.currentStock <= 0) return 'OUT';
    const min = i.minLevel ?? 0;
    return min > 0 && i.currentStock <= min ? 'LOW' : 'OK';
  }

  private view(i: InventoryItem) {
    return { ...i, status: this.status(i) };
  }

  async list(q: { programme?: InventoryProgramme; category?: string; search?: string; status?: 'LOW' | 'OUT' | 'OK'; includeInactive?: boolean }) {
    const qb = this.items.createQueryBuilder('i').orderBy('i.itemCode', 'ASC').addOrderBy('i.sku', 'ASC');
    if (!q.includeInactive) qb.andWhere('i.isActive = true');
    if (q.programme) qb.andWhere('i.programme = :p', { p: q.programme });
    if (q.category) qb.andWhere('i.category = :c', { c: q.category });
    if (q.search) qb.andWhere('(i.sku ILIKE :s OR i.itemCode ILIKE :s OR i.name ILIKE :s OR i.location ILIKE :s)', { s: `%${q.search.trim()}%` });
    let rows = (await qb.getMany()).map((i) => this.view(i))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || sizeRank(a.size) - sizeRank(b.size));
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    const categories: Array<{ category: string }> = await this.ds.query(`SELECT DISTINCT category FROM inventory_items WHERE "isActive" ORDER BY 1`);
    return {
      items: rows,
      categories: categories.map((c) => c.category),
      totals: {
        skus: rows.length,
        units: rows.reduce((s, r) => s + r.currentStock, 0),
        low: rows.filter((r) => r.status === 'LOW').length,
        out: rows.filter((r) => r.status === 'OUT').length,
      },
    };
  }

  /** Totals per item (all sizes together), like the store file's summary tab. */
  async summary(programme?: InventoryProgramme) {
    const rows: any[] = await this.ds.query(`
      SELECT "itemCode", min(name) AS name, programme, min(category) AS category, count(*)::int AS sizes,
             sum("currentStock")::int AS stock,
             COALESCE((SELECT sum(m.quantity) FROM inventory_movements m JOIN inventory_items x ON x.id = m."itemId"
                       WHERE x."itemCode" = i."itemCode" AND m.type = 'IN'), 0)::int AS "totalIn",
             COALESCE((SELECT -sum(m.quantity) FROM inventory_movements m JOIN inventory_items x ON x.id = m."itemId"
                       WHERE x."itemCode" = i."itemCode" AND m.type = 'OUT'), 0)::int AS "totalOut",
             COALESCE((SELECT sum(m.quantity) FROM inventory_movements m JOIN inventory_items x ON x.id = m."itemId"
                       WHERE x."itemCode" = i."itemCode" AND m.type = 'OPENING'), 0)::int AS opening
      FROM inventory_items i WHERE "isActive" ${programme ? 'AND programme = $1' : ''}
      GROUP BY "itemCode", programme ORDER BY "itemCode"`, programme ? [programme] : []);
    return rows;
  }

  async get(id: string) {
    const i = await this.items.findOne({ where: { id } });
    if (!i) throw new NotFoundException('Item not found');
    const history = await this.moves.find({ where: { itemId: id }, order: { createdAt: 'DESC' }, take: 200 });
    const sizes = (await this.items.find({ where: { itemCode: i.itemCode } })).sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
    return { item: this.view(i), sizes: sizes.map((s) => this.view(s)), history };
  }

  /** Next free item number for a programme: LL-021, LL-022 … */
  private async nextGroup(m: EntityManager, prefix: string) {
    const [r] = await m.query(
      `SELECT COALESCE(max((regexp_match(sku, '^' || $1 || '-(\\d{3,})-'))[1]::int), 0) AS n FROM inventory_items`, [prefix]);
    return String(Number(r.n) + 1).padStart(3, '0');
  }

  /**
   * Add an item in one or more sizes. Each size becomes its own SKU with an
   * opening stock movement, so the opening count is part of the history.
   */
  async create(dto: {
    name: string; programme: InventoryProgramme; category: string; itemCode?: string; unit?: string; condition?: string;
    location?: string; notes?: string; minLevel?: number;
    sizes: Array<{ size?: string | null; openingQty?: number; minLevel?: number | null }>;
  }, actorId?: string) {
    if (!dto.sizes?.length) throw new BadRequestException('Add at least one size (or one row with no size)');
    const codes = dto.sizes.map((s) => sizeCode(s.size));
    if (new Set(codes).size !== codes.length) throw new BadRequestException('The same size is listed twice');
    return this.ds.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('inventory_sku'))`);
      const prefix = PREFIX[dto.programme];
      const group = await this.nextGroup(m, prefix);
      const itemCode = (dto.itemCode?.trim() || `${prefix}-${group}`).toUpperCase();
      const batch = `NEW-${Date.now().toString(36).toUpperCase()}`;
      const today = new Date().toISOString().slice(0, 10);
      const created: InventoryItem[] = [];
      for (const s of dto.sizes) {
        const sku = `${prefix}-${group}-${sizeCode(s.size)}`;
        const opening = Math.max(0, Math.floor(s.openingQty ?? 0));
        const item = await m.save(InventoryItem, m.create(InventoryItem, {
          sku, itemCode, name: dto.name.trim(), programme: dto.programme, category: dto.category.trim(),
          size: s.size?.trim() || null, unit: dto.unit || 'Pcs', condition: dto.condition || 'New',
          currentStock: opening, minLevel: s.minLevel ?? dto.minLevel ?? null, location: dto.location || null, notes: dto.notes || null,
        }));
        await m.save(InventoryMovement, m.create(InventoryMovement, {
          itemId: item.id, type: StockMovementType.OPENING, quantity: opening, balanceAfter: opening,
          movedOn: today, reason: 'Opening stock', batch, recordedById: actorId ?? null,
        }));
        created.push(item);
      }
      return created.map((c) => this.view(c));
    });
  }

  /**
   * Start the store again (Karim, Oct 2026): every item and movement is removed
   * and one practice item is left, so stock is then added by hand. Only a super
   * admin can do it, and only after typing CLEAR INVENTORY. Audited.
   */
  async reset(actorId?: string) {
    const before = await this.items.count();
    const kept = await this.ds.transaction(async (m) => {
      await m.query('DELETE FROM inventory_movements');
      await m.query('DELETE FROM inventory_items');
      const t = TEST_ITEM, sz = t.sizes[0];
      const item = await m.save(InventoryItem, m.create(InventoryItem, {
        sku: `LL-TEST-${sz.size}`, itemCode: t.itemCode, name: t.name, programme: t.programme, category: t.category,
        size: sz.size, unit: t.unit, condition: t.condition, currentStock: sz.openingQty, notes: t.notes,
      }));
      await m.save(InventoryMovement, m.create(InventoryMovement, {
        itemId: item.id, type: StockMovementType.OPENING, quantity: sz.openingQty, balanceAfter: sz.openingQty,
        movedOn: new Date().toISOString().slice(0, 10), reason: 'Opening stock', batch: 'PRACTICE', recordedById: actorId ?? null,
      }));
      return [item];
    });
    return { removedItems: before, kept: kept.map((i) => this.view(i)) };
  }

  async update(id: string, dto: Partial<Pick<InventoryItem, 'name' | 'category' | 'unit' | 'condition' | 'minLevel' | 'location' | 'notes' | 'isActive'>>) {
    const i = await this.items.findOne({ where: { id } });
    if (!i) throw new NotFoundException('Item not found');
    Object.assign(i, dto);
    return this.view(await this.items.save(i));
  }

  /**
   * Record stock coming in, going out, or a stock-take correction — several
   * items at once, one batch. Locks each item row so two people taking the
   * last pieces at the same moment can't take them twice.
   */
  async move(dto: {
    type: StockMovementType; movedOn?: string; party?: string; reason?: string; reference?: string; playerId?: string;
    lines: MovementLine[];
  }, actorId?: string) {
    if (dto.type === StockMovementType.OPENING) throw new BadRequestException('Opening stock is set when an item is added');
    if (!dto.lines?.length) throw new BadRequestException('Add at least one item');
    if (dto.type === StockMovementType.OUT && !dto.party?.trim()) throw new BadRequestException('Say who the items were given to');
    const movedOn = dto.movedOn ?? new Date().toISOString().slice(0, 10);
    const batch = `${dto.type === 'IN' ? 'IN' : dto.type === 'OUT' ? 'OUT' : 'ADJ'}-${movedOn.replace(/-/g, '').slice(2)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return this.ds.transaction(async (m) => {
      const ids = dto.lines.map((l) => l.itemId).filter(Boolean) as string[];
      const skus = dto.lines.map((l) => l.sku?.trim().toUpperCase()).filter(Boolean) as string[];
      const found = await m.getRepository(InventoryItem).createQueryBuilder('i').setLock('pessimistic_write')
        .where(ids.length && skus.length ? '(i.id IN (:...ids) OR i.sku IN (:...skus))' : ids.length ? 'i.id IN (:...ids)' : 'i.sku IN (:...skus)',
          { ids: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'], skus: skus.length ? skus : ['-'] })
        .getMany();
      const out: InventoryMovement[] = [];
      const errors: string[] = [];
      const touched = new Map<string, InventoryItem>();
      for (const l of dto.lines) {
        const item = found.find((f) => f.id === l.itemId || f.sku === l.sku?.trim().toUpperCase());
        if (!item) { errors.push(`${l.sku ?? l.itemId}: not found`); continue; }
        const cur = touched.get(item.id) ?? item;
        let qty: number;
        if (dto.type === StockMovementType.ADJUST) {
          if (l.countedQty == null || l.countedQty < 0) { errors.push(`${item.sku}: enter the counted quantity`); continue; }
          qty = Math.floor(l.countedQty) - cur.currentStock;
          if (qty === 0) continue;
        } else {
          const n = Math.floor(Number(l.quantity));
          if (!(n > 0)) { errors.push(`${item.sku}: quantity must be at least 1`); continue; }
          qty = dto.type === StockMovementType.OUT ? -n : n;
          if (cur.currentStock + qty < 0) { errors.push(`${item.sku}: only ${cur.currentStock} in stock`); continue; }
        }
        cur.currentStock += qty;
        touched.set(item.id, cur);
        out.push(m.create(InventoryMovement, {
          itemId: item.id, type: dto.type, quantity: qty, balanceAfter: cur.currentStock, movedOn,
          party: dto.party?.trim() || null, reason: dto.reason?.trim() || null, reference: dto.reference?.trim() || null,
          playerId: dto.playerId ?? null, batch, recordedById: actorId ?? null,
        }));
      }
      if (errors.length) throw new BadRequestException({ error: 'StockCheck', message: errors.join('; '), lines: errors });
      for (const it of touched.values()) await m.update(InventoryItem, it.id, { currentStock: it.currentStock });
      const saved = await m.save(InventoryMovement, out);
      return { batch, movements: saved.length, items: [...touched.values()].map((i) => ({ sku: i.sku, name: i.name, size: i.size, stock: i.currentStock })) };
    });
  }

  async movements(q: { from?: string; to?: string; type?: StockMovementType; itemId?: string; search?: string; programme?: InventoryProgramme; limit?: number }) {
    const qb = this.moves.createQueryBuilder('m').innerJoinAndSelect('m.item', 'i')
      .orderBy('m.createdAt', 'DESC').take(Math.min(q.limit ?? 300, 2000));
    if (q.from) qb.andWhere('m.movedOn >= :f', { f: q.from });
    if (q.to) qb.andWhere('m.movedOn <= :t', { t: q.to });
    if (q.type) qb.andWhere('m.type = :ty', { ty: q.type });
    if (q.itemId) qb.andWhere('m.itemId = :id', { id: q.itemId });
    if (q.programme) qb.andWhere('i.programme = :p', { p: q.programme });
    if (q.search) qb.andWhere('(i.sku ILIKE :s OR i.name ILIKE :s OR m.party ILIKE :s OR m.reference ILIKE :s OR m.batch ILIKE :s)', { s: `%${q.search.trim()}%` });
    return (await qb.getMany()).map((m) => ({
      id: m.id, at: m.createdAt, movedOn: m.movedOn, type: m.type, quantity: m.quantity, balanceAfter: m.balanceAfter,
      party: m.party, reason: m.reason, reference: m.reference, batch: m.batch,
      item: { id: m.item.id, sku: m.item.sku, name: m.item.name, size: m.item.size, programme: m.item.programme },
    }));
  }

  /** Load the store's item master (used once, on first boot). Existing SKUs are skipped. */
  async importRows(rows: Array<{
    sku: string; itemCode: string; name: string; programme: InventoryProgramme; category: string; size?: string | null;
    unit?: string; condition?: string; openingQty: number; minLevel?: number | null; location?: string | null; notes?: string | null;
  }>, source: string) {
    const existing = new Set((await this.items.find({ select: { sku: true } })).map((i) => i.sku));
    const fresh = rows.filter((r) => !existing.has(r.sku));
    if (!fresh.length) return { imported: 0, skipped: rows.length };
    const today = new Date().toISOString().slice(0, 10);
    await this.ds.transaction(async (m) => {
      for (const r of fresh) {
        const qty = Math.max(0, Math.floor(r.openingQty || 0));
        const item = await m.save(InventoryItem, m.create(InventoryItem, {
          sku: r.sku, itemCode: r.itemCode, name: r.name, programme: r.programme, category: r.category,
          size: r.size ?? null, unit: r.unit ?? 'Pcs', condition: r.condition ?? 'New', currentStock: qty,
          minLevel: r.minLevel ?? null, location: r.location ?? null, notes: r.notes ?? null,
        }));
        await m.save(InventoryMovement, m.create(InventoryMovement, {
          itemId: item.id, type: StockMovementType.OPENING, quantity: qty, balanceAfter: qty, movedOn: today,
          reason: 'Opening stock', reference: source, batch: 'IMPORT',
        }));
      }
    });
    return { imported: fresh.length, skipped: rows.length - fresh.length };
  }

  findBySkus(skus: string[]) { return this.items.find({ where: { sku: In(skus) } }); }
}
