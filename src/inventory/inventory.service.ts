import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly db: DatabaseService) {}

  // Optional equipment-registry detail columns (not all items use them).
  private readonly extraFields = [
    'serial_number', 'manufacturer', 'manufacturer_contact', 'owner', 'device_status',
    'label_printed', 'calibration_required', 'calibration_method', 'maintenance_next',
    'maintenance_last', 'maintenance_freq_months', 'calibration_alert_value', 'calibration_alert_unit',
    'service_provider', 'service_provider_contact',
    'training_required', 'training_material', 'trainer', 'date_of_purchase', 'date_in_service',
  ];

  // Equipment columns grouped by how a CSV cell is parsed (used by importCsv).
  // Together with calibration_alert_unit these cover every field in extraFields.
  private readonly EXTRA_TEXT_COLS = [
    'serial_number', 'manufacturer', 'manufacturer_contact', 'owner', 'device_status',
    'calibration_method', 'service_provider', 'service_provider_contact', 'training_material', 'trainer',
  ];
  private readonly EXTRA_INT_COLS = ['maintenance_freq_months', 'calibration_alert_value'];
  private readonly EXTRA_BOOL_COLS = ['label_printed', 'calibration_required', 'training_required'];
  private readonly EXTRA_DATE_COLS = ['maintenance_next', 'maintenance_last', 'date_of_purchase', 'date_in_service'];

  // part_id is intentionally absent: it's a generated code and cannot be edited.
  private readonly editableColumns = [
    'description', 'category_id', 'location_id', 'sub_location',
    'qty_found', 'qty_needed', 'qty_available', 'low_stock_threshold', 'notes',
    ...this.extraFields,
  ];

  // Quantity of this item currently out on an active borrow (transfers included;
  // takes and breakdowns excluded). Borrowed items are still company stock — they
  // return on 'return', so they count toward what the company owns.
  private readonly BORROWED = `COALESCE((SELECT SUM(t.qty) FROM item_transactions t
    WHERE t.item_id = i.id AND t.action = 'borrow' AND t.status = 'active'), 0)`;

  // An item is low on stock when what the company owns (available + still-borrowed)
  // is at or below its threshold. With no threshold set, we alert only at 0.
  private readonly LOW_STOCK = `(i.qty_available + ${this.BORROWED}) <= COALESCE(i.low_stock_threshold, 0)`;

  // An item is "calibration due" when it has a next-calibration date and an alert
  // threshold, and the remaining time to that date has dropped to the threshold
  // (or below — includes overdue). The unit is days by default, or months.
  private readonly CAL_DUE = `i.maintenance_next IS NOT NULL
    AND i.calibration_alert_value IS NOT NULL
    AND (i.maintenance_next - (i.calibration_alert_value *
      (CASE i.calibration_alert_unit WHEN 'months' THEN INTERVAL '1 month' ELSE INTERVAL '1 day' END)))::date
      <= CURRENT_DATE`;

  /** Returns the id of an existing category with this name, or creates it. */
  private async resolveCategoryId(name: string): Promise<number> {
    const clean = name.trim();
    const existing = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM categories WHERE name = $1',
      [clean],
    );
    if (existing) return existing.id;
    const created = await this.db.queryOne<{ id: number }>(
      'INSERT INTO categories (name) VALUES ($1) RETURNING id',
      [clean],
    );
    return created!.id;
  }

  /** Returns the id of an existing location with this name, or creates it. */
  private async resolveLocationId(name: string): Promise<number> {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Location is required');
    const existing = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM locations WHERE name = $1',
      [clean],
    );
    if (existing) return existing.id;
    const created = await this.db.queryOne<{ id: number }>(
      'INSERT INTO locations (name) VALUES ($1) RETURNING id',
      [clean],
    );
    return created!.id;
  }

  /** Returns the id of an existing project with this name, or creates it (used by CSV import). */
  private async resolveProjectId(name: string, userId: number): Promise<number> {
    const clean = (name ?? '').trim();
    const existing = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM projects WHERE name = $1',
      [clean],
    );
    if (existing) return existing.id;
    const created = await this.db.queryOne<{ id: number }>(
      'INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id',
      [clean, userId],
    );
    return created!.id;
  }

  async createItem(dto: CreateItemDto) {
    let categoryId = dto.category_id ?? null;
    if (dto.categoryName) categoryId = await this.resolveCategoryId(dto.categoryName);

    // Location is stored by id; the name is resolved (find-or-create).
    const locationId = await this.resolveLocationId(dto.location);

    // If no available quantity is given, start from what was found (or 0).
    const qtyAvailable = dto.qty_available ?? dto.qty_found ?? 0;

    // Core columns + optional equipment-detail columns, built dynamically.
    // part_id is NOT taken from the user: it's a generated, immutable code.
    const values: Record<string, any> = {
      description: dto.description,
      category_id: categoryId,
      location_id: locationId,
      sub_location: dto.sub_location ?? null,
      qty_found: dto.qty_found ?? null,
      qty_needed: dto.qty_needed ?? null,
      notes: dto.notes ?? null,
      qty_available: qtyAvailable,
      low_stock_threshold: dto.low_stock_threshold ?? null,
    };
    for (const f of this.extraFields) values[f] = (dto as any)[f] ?? null;

    const cols = Object.keys(values);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

    // Insert, then set part_id from the generated code (derived from the id).
    return this.db.transaction(async (client) => {
      const inserted = (
        await client.query(`INSERT INTO items (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`, Object.values(values))
      ).rows[0];
      const code = this.itemCode(inserted.id);
      return (
        await client.query('UPDATE items SET part_id = $1 WHERE id = $2 RETURNING *', [code, inserted.id])
      ).rows[0];
    });
  }

  /** The item's stable, non-editable code, derived from its primary key. */
  private itemCode(id: number): string {
    return `V-EQ-${String(id).padStart(4, '0')}`;
  }

  async updateItem(id: number, dto: UpdateItemDto) {
    // A new category name takes priority: find-or-create, then set category_id.
    if (dto.categoryName) {
      (dto as any).category_id = await this.resolveCategoryId(dto.categoryName);
    }
    // Location comes in by name → resolve (find-or-create) to location_id.
    if (dto.location !== undefined) {
      (dto as any).location_id = await this.resolveLocationId(dto.location);
    }

    // Build a SET clause only from the fields actually provided.
    const fields: string[] = [];
    const params: any[] = [];
    for (const col of this.editableColumns) {
      const value = (dto as any)[col];
      if (value !== undefined) {
        params.push(value);
        fields.push(`${col} = $${params.length}`);
      }
    }
    if (fields.length === 0) return this.findOne(id);

    params.push(id);
    const row = await this.db.queryOne(
      `UPDATE items SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!row) throw new NotFoundException(`Item ${id} not found`);
    return row;
  }

  async deleteItem(id: number) {
    // Keep history intact: an item that was ever used cannot be deleted.
    const used = await this.db.queryOne('SELECT 1 FROM item_transactions WHERE item_id = $1 LIMIT 1', [id]);
    if (used) throw new BadRequestException('This item has history and cannot be deleted');

    const row = await this.db.queryOne('DELETE FROM items WHERE id = $1 RETURNING id', [id]);
    if (!row) throw new NotFoundException(`Item ${id} not found`);
    return { deleted: true, id };
  }

  async findAll(filters: { location?: string; search?: string; lowStock?: boolean; calibrationDue?: boolean; borrowed?: boolean; page?: number; limit?: number }) {
    const { location, search, lowStock, calibrationDue, borrowed, page = 1, limit = 50 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (location) {
      params.push(location);
      conditions.push(`l.name = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`i.description ILIKE $${params.length}`);
    }

    if (lowStock) {
      conditions.push(this.LOW_STOCK);
    }

    if (calibrationDue) {
      conditions.push(this.CAL_DUE);
    }

    if (borrowed) {
      conditions.push(`${this.BORROWED} > 0`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);

    const sql = `
      SELECT
        i.id,
        i.part_id,
        i.description,
        c.name    AS category,
        l.name    AS location,
        i.sub_location,
        i.qty_found,
        i.qty_needed,
        i.qty_available,
        ${this.BORROWED} AS borrowed,
        i.low_stock_threshold,
        (${this.LOW_STOCK}) AS low_stock,
        i.maintenance_next,
        (${this.CAL_DUE}) AS calibration_due,
        i.notes,
        p.name    AS project,
        COUNT(*) OVER() AS _total
      FROM items i
      LEFT JOIN categories c ON i.category_id = c.id
      JOIN      locations  l ON i.location_id = l.id
      LEFT JOIN projects   p ON i.project_id  = p.id
      ${where}
      ORDER BY i.description
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const rows = await this.db.query<any>(sql, params);
    const total = rows.length > 0 ? Number(rows[0]._total) : 0;
    const items = rows.map(({ _total, ...item }) => item);

    return { data: items, total, page, limit };
  }

  async getLowStockCount() {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM items i WHERE ${this.LOW_STOCK}`,
    );
    return { count: Number(row?.count ?? 0) };
  }

  async getCalibrationDueCount() {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM items i WHERE ${this.CAL_DUE}`,
    );
    return { count: Number(row?.count ?? 0) };
  }

  async getBorrowedCount() {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM items i WHERE ${this.BORROWED} > 0`,
    );
    return { count: Number(row?.count ?? 0) };
  }

  async findOne(id: number) {
    return this.db.queryOne(
      `SELECT i.*, c.name AS category, l.name AS location, p.name AS project,
              ${this.BORROWED} AS borrowed,
              (${this.LOW_STOCK}) AS low_stock,
              (${this.CAL_DUE}) AS calibration_due
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       JOIN      locations  l ON i.location_id = l.id
       LEFT JOIN projects   p ON i.project_id  = p.id
       WHERE i.id = $1`,
      [id],
    );
  }

  /** All locations with how many items each holds (zero-count ones included). */
  async getLocations() {
    return this.db.query<{ id: number; location: string; count: string }>(
      `SELECT l.id, l.name AS location, COUNT(i.id) AS count
       FROM locations l
       LEFT JOIN items i ON i.location_id = l.id
       GROUP BY l.id, l.name
       ORDER BY l.name`,
    );
  }

  async getCategories() {
    return this.db.query(
      `SELECT c.id, c.name, COUNT(i.id) AS count
       FROM categories c
       LEFT JOIN items i ON i.category_id = c.id
       GROUP BY c.id, c.name
       ORDER BY c.name`,
    );
  }

  /** Create a location (rejects blanks and duplicates). */
  async createLocation(name: string) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Location name is required');
    const dup = await this.db.queryOne('SELECT 1 FROM locations WHERE name = $1', [clean]);
    if (dup) throw new BadRequestException('This location already exists');
    return this.db.queryOne('INSERT INTO locations (name) VALUES ($1) RETURNING id, name', [clean]);
  }

  /**
   * Delete a location. If items still reference it, deletion is refused (400)
   * unless `force` is set — in which case those items are first moved to
   * `targetLocationId` (required, must be a different existing location).
   */
  async deleteLocation(id: number, force = false, targetLocationId?: number) {
    const used = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*) AS count FROM items WHERE location_id = $1', [id],
    );
    const inUse = Number(used?.count ?? 0) > 0;

    if (inUse && !force) {
      throw new BadRequestException('This location is used by items and cannot be deleted');
    }

    if (inUse && force) {
      if (!targetLocationId || targetLocationId === id) {
        throw new BadRequestException('Choose another location to move the items to');
      }
      const target = await this.db.queryOne('SELECT id FROM locations WHERE id = $1', [targetLocationId]);
      if (!target) throw new NotFoundException(`Target location ${targetLocationId} not found`);

      return this.db.transaction(async (client) => {
        await client.query('UPDATE items SET location_id = $1 WHERE location_id = $2', [targetLocationId, id]);
        const row = await client.query('DELETE FROM locations WHERE id = $1 RETURNING id', [id]);
        if (row.rowCount === 0) throw new NotFoundException(`Location ${id} not found`);
        return { deleted: true, id, moved: Number(used?.count ?? 0), to: targetLocationId };
      });
    }

    const row = await this.db.queryOne('DELETE FROM locations WHERE id = $1 RETURNING id', [id]);
    if (!row) throw new NotFoundException(`Location ${id} not found`);
    return { deleted: true, id };
  }

  /**
   * Force-delete a location, moving each of its items to a chosen destination
   * (a per-item mapping). Every item currently in the location must be assigned;
   * otherwise the deletion is refused. All-or-nothing.
   */
  async reassignAndDeleteLocation(id: number, assignments: { itemId: number; locationId: number }[]) {
    if (!assignments || assignments.length === 0) throw new BadRequestException('No assignments provided');

    return this.db.transaction(async (client) => {
      const loc = await client.query('SELECT id FROM locations WHERE id = $1', [id]);
      if (loc.rowCount === 0) throw new NotFoundException(`Location ${id} not found`);

      for (const a of assignments) {
        const itemId = Number(a.itemId);
        const locationId = Number(a.locationId);
        if (!locationId || locationId === id) {
          throw new BadRequestException('Each item must move to a different location');
        }
        const target = await client.query('SELECT id FROM locations WHERE id = $1', [locationId]);
        if (target.rowCount === 0) throw new NotFoundException(`Location ${locationId} not found`);
        await client.query(
          'UPDATE items SET location_id = $1 WHERE id = $2 AND location_id = $3',
          [locationId, itemId, id],
        );
      }

      // Every item must have been moved out before we can delete the location.
      const left = await client.query<{ c: string }>('SELECT COUNT(*) AS c FROM items WHERE location_id = $1', [id]);
      if (Number(left.rows[0].c) > 0) {
        throw new BadRequestException('Every item must be assigned a destination before deleting');
      }
      await client.query('DELETE FROM locations WHERE id = $1', [id]);
      return { deleted: true, id, moved: assignments.length };
    });
  }

  /** Create a category (rejects blanks and duplicates). */
  async createCategory(name: string) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Category name is required');
    const dup = await this.db.queryOne('SELECT 1 FROM categories WHERE name = $1', [clean]);
    if (dup) throw new BadRequestException('This category already exists');
    return this.db.queryOne('INSERT INTO categories (name) VALUES ($1) RETURNING id, name', [clean]);
  }

  /**
   * Delete a category. If items still reference it, deletion is refused (400)
   * unless `force` is set — in which case those items are either moved to
   * `targetCategoryId` (if given, must be a different existing category) or
   * detached (their category becomes null / "uncategorized").
   */
  async deleteCategory(id: number, force = false, targetCategoryId?: number) {
    const used = await this.db.queryOne('SELECT 1 FROM items WHERE category_id = $1 LIMIT 1', [id]);

    if (used && !force) {
      throw new BadRequestException('This category is used by items and cannot be deleted');
    }

    if (used && force) {
      if (targetCategoryId) {
        if (targetCategoryId === id) throw new BadRequestException('Choose a different category');
        const target = await this.db.queryOne('SELECT id FROM categories WHERE id = $1', [targetCategoryId]);
        if (!target) throw new NotFoundException(`Target category ${targetCategoryId} not found`);
      }
      return this.db.transaction(async (client) => {
        // Move to another category, or detach (null) when no target is given.
        await client.query('UPDATE items SET category_id = $1 WHERE category_id = $2', [targetCategoryId ?? null, id]);
        const row = await client.query('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
        if (row.rowCount === 0) throw new NotFoundException(`Category ${id} not found`);
        return { deleted: true, id, ...(targetCategoryId ? { movedTo: targetCategoryId } : { detached: true }) };
      });
    }

    const row = await this.db.queryOne('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
    if (!row) throw new NotFoundException(`Category ${id} not found`);
    return { deleted: true, id };
  }

  /**
   * Builds a CSV string of all items matching the optional filters (no pagination).
   */
  async exportCsv(filters: { location?: string; search?: string }) {
    const { location, search } = filters;
    const conditions: string[] = [];
    const params: any[] = [];

    if (location) {
      params.push(location);
      conditions.push(`l.name = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`i.description ILIKE $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const extraCols = this.extraFields.map((f) => `i.${f}`).join(', ');
    const rows = await this.db.query<any>(
      `SELECT i.id, i.part_id, i.description, c.name AS category, l.name AS location,
              i.sub_location, i.qty_found, i.qty_needed, i.qty_available,
              i.low_stock_threshold, p.name AS project, i.notes, ${extraCols}
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       JOIN      locations  l ON i.location_id = l.id
       LEFT JOIN projects   p ON i.project_id  = p.id
       ${where}
       ORDER BY i.description`,
      params,
    );

    const columns = [
      'id', 'part_id', 'description', 'category', 'location',
      'sub_location', 'qty_found', 'qty_needed', 'qty_available',
      'low_stock_threshold', 'project', 'notes', ...this.extraFields,
    ];

    // Wrap a value in quotes only if it contains a comma, quote or newline.
    const escape = (value: any) => {
      if (value === null || value === undefined) return '';
      const s = String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push(columns.map((col) => escape(row[col])).join(','));
    }
    return lines.join('\n');
  }

  /**
   * Parses CSV text into an array of records keyed by (lower-cased) header.
   * Handles quoted fields, escaped quotes ("") and CRLF line endings.
   */
  private parseCsv(text: string): Record<string, string>[] {
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;

    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        pushField();
      } else if (c === '\n') {
        pushRow();
      } else if (c === '\r') {
        // ignore; \n handles the line break
      } else field += c;
    }
    // Flush the last field/row unless the file ended on a clean newline.
    if (field !== '' || row.length > 0) pushRow();

    if (rows.length === 0) return [];
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    return rows.slice(1)
      // Skip fully-empty lines.
      .filter((r) => r.some((v) => v.trim() !== ''))
      .map((r) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
        return obj;
      });
  }

  /**
   * Imports items from CSV text. Recognised columns (header names, any order):
   * core — description, location, part_id, category, project, sub_location,
   *   qty_found, qty_needed, qty_available, low_stock_threshold, notes;
   * equipment — serial_number, manufacturer, manufacturer_contact, owner,
   *   device_status, label_printed, calibration_required, calibration_method,
   *   maintenance_next, maintenance_last, maintenance_freq_months,
   *   calibration_alert_value, calibration_alert_unit, service_provider,
   *   service_provider_contact, training_required, training_material, trainer,
   *   date_of_purchase, date_in_service.
   * - description and location are required; unknown headers are ignored.
   * - booleans accept yes/no·true/false·1/0; dates are YYYY-MM-DD;
   *   calibration_alert_unit is days/months.
   * - unknown category / location / project names are created on the fly.
   * - a row whose part_id matches an existing item updates it (upsert); other
   *   rows create a new item.
   * Rows are processed independently: a bad row is reported, the rest still import.
   */
  async importCsv(csvText: string, userId: number) {
    const records = this.parseCsv(csvText ?? '');
    if (records.length === 0) throw new BadRequestException('The CSV file has no data rows');

    let created = 0;
    let updated = 0;
    const errors: { row: number; message: string }[] = [];

    // Parses an integer cell; '' → null; anything non-numeric → throws.
    const intOrNull = (v: string, label: string): number | null => {
      const s = (v ?? '').trim();
      if (s === '') return null;
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number ≥ 0`);
      return n;
    };

    // Parses a boolean cell; '' → null; accepts yes/no, true/false, 1/0.
    const boolOrNull = (v: string, label: string): boolean | null => {
      const s = (v ?? '').trim().toLowerCase();
      if (s === '') return null;
      if (['yes', 'true', '1', 'y'].includes(s)) return true;
      if (['no', 'false', '0', 'n'].includes(s)) return false;
      throw new Error(`${label} must be yes/no`);
    };

    // Parses a date cell; '' → null; requires YYYY-MM-DD.
    const dateOrNull = (v: string, label: string): string | null => {
      const s = (v ?? '').trim();
      if (s === '') return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${label} must be a date (YYYY-MM-DD)`);
      return s;
    };

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const rowNo = i + 2; // +1 for header, +1 for 1-based
      try {
        const description = (r['description'] ?? '').trim();
        const location = (r['location'] ?? '').trim();
        if (!description) throw new Error('description is required');
        if (!location) throw new Error('location is required');

        const qtyFound = intOrNull(r['qty_found'], 'qty_found');
        const qtyNeeded = intOrNull(r['qty_needed'], 'qty_needed');
        const qtyAvailRaw = intOrNull(r['qty_available'], 'qty_available');
        const threshold = intOrNull(r['low_stock_threshold'], 'low_stock_threshold');

        const locationId = await this.resolveLocationId(location);
        const categoryName = (r['category'] ?? '').trim();
        const categoryId = categoryName ? await this.resolveCategoryId(categoryName) : null;
        const projectName = (r['project'] ?? '').trim();
        const projectId = projectName ? await this.resolveProjectId(projectName, userId) : null;
        const partId = (r['part_id'] ?? '').trim() || null;
        const subLocation = (r['sub_location'] ?? '').trim() || null;
        const notes = (r['notes'] ?? '').trim() || null;
        const qtyAvailable = qtyAvailRaw ?? qtyFound ?? 0;

        // Optional equipment columns, parsed by type ('' → null; bad value → row error).
        const extra: Record<string, string | number | boolean | null> = {};
        for (const c of this.EXTRA_TEXT_COLS) extra[c] = (r[c] ?? '').trim() || null;
        for (const c of this.EXTRA_INT_COLS) extra[c] = intOrNull(r[c], c);
        for (const c of this.EXTRA_BOOL_COLS) extra[c] = boolOrNull(r[c], c);
        for (const c of this.EXTRA_DATE_COLS) extra[c] = dateOrNull(r[c], c);
        const unit = (r['calibration_alert_unit'] ?? '').trim().toLowerCase();
        if (unit && unit !== 'days' && unit !== 'months') {
          throw new Error("calibration_alert_unit must be 'days' or 'months'");
        }
        extra['calibration_alert_unit'] = unit || null;

        // Match an existing item to update (upsert):
        //  1. by part_id when the row has one that already exists;
        //  2. otherwise by description (name) — so re-importing without a
        //     part_id updates the same item instead of duplicating it.
        //     A name shared by several items is ambiguous → the row is reported.
        let existing = partId
          ? await this.db.queryOne<{ id: number }>('SELECT id FROM items WHERE part_id = $1', [partId])
          : null;

        if (!existing) {
          const byName = await this.db.query<{ id: number }>(
            'SELECT id FROM items WHERE description = $1', [description],
          );
          if (byName.length > 1) {
            throw new Error(`several items are named "${description}" — set a Part ID to choose which one`);
          }
          if (byName.length === 1) existing = byName[0];
        }

        if (existing) {
          // Columns set directly (a blank cell clears the value), plus part_id and
          // project_id which are kept unless the row provides one (COALESCE).
          const sets = [
            { col: 'description', val: description },
            { col: 'category_id', val: categoryId },
            { col: 'location_id', val: locationId },
            { col: 'sub_location', val: subLocation },
            { col: 'qty_found', val: qtyFound },
            { col: 'qty_needed', val: qtyNeeded },
            { col: 'qty_available', val: qtyAvailable },
            { col: 'low_stock_threshold', val: threshold },
            { col: 'notes', val: notes },
            ...Object.entries(extra).map(([col, val]) => ({ col, val })),
            { col: 'part_id', val: partId, coalesce: true },
            { col: 'project_id', val: projectId, coalesce: true },
          ];
          const params: any[] = [];
          const clause = sets.map((s) => {
            params.push(s.val);
            const ph = `$${params.length}`;
            return `${s.col} = ${(s as any).coalesce ? `COALESCE(${ph}, ${s.col})` : ph}`;
          }).join(', ');
          params.push(existing.id);
          await this.db.query(`UPDATE items SET ${clause} WHERE id = $${params.length}`, params);
          updated++;
        } else {
          const cols = [
            { col: 'part_id', val: partId },
            { col: 'description', val: description },
            { col: 'category_id', val: categoryId },
            { col: 'location_id', val: locationId },
            { col: 'sub_location', val: subLocation },
            { col: 'qty_found', val: qtyFound },
            { col: 'qty_needed', val: qtyNeeded },
            { col: 'notes', val: notes },
            { col: 'qty_available', val: qtyAvailable },
            { col: 'low_stock_threshold', val: threshold },
            { col: 'project_id', val: projectId },
            ...Object.entries(extra).map(([col, val]) => ({ col, val })),
          ];
          const names = cols.map((c) => c.col).join(', ');
          const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
          await this.db.query(
            `INSERT INTO items (${names}) VALUES (${placeholders})`,
            cols.map((c) => c.val),
          );
          created++;
        }
      } catch (e: any) {
        errors.push({ row: rowNo, message: e?.message ?? 'Invalid row' });
      }
    }

    return { created, updated, errors, total: records.length };
  }

  /**
   * Finds the user's active borrow of an item. If a specific borrowId is given
   * (e.g. from the "My Borrows" screen, where a user may hold the same item on
   * several borrows), that exact borrow is targeted; otherwise the most recent
   * active borrow is used. Cancelled (undone) borrows are always ignored.
   */
  private findActiveBorrow(
    client: any,
    itemId: number,
    userId: number,
    borrowId?: number,
  ) {
    if (borrowId) {
      return client.query(
        `SELECT id, qty FROM item_transactions
         WHERE id = $1 AND item_id = $2 AND user_id = $3 AND action = 'borrow'
           AND status = 'active' AND cancelled_at IS NULL`,
        [borrowId, itemId, userId],
      );
    }
    return client.query(
      `SELECT id, qty FROM item_transactions
       WHERE item_id = $1 AND user_id = $2 AND action = 'borrow'
         AND status = 'active' AND cancelled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [itemId, userId],
    );
  }

  /**
   * Take an item permanently: decrement stock and log a 'take' transaction.
   */
  async take(itemId: number, userId: number, qty: number, notes?: string) {
    return this.checkoutAction(itemId, userId, qty, 'take', notes);
  }

  /**
   * Borrow an item temporarily: decrement stock and log an 'active' 'borrow' transaction.
   */
  async borrow(itemId: number, userId: number, qty: number, notes?: string) {
    return this.checkoutAction(itemId, userId, qty, 'borrow', notes);
  }

  /**
   * Shared logic for 'take' and 'borrow': both remove stock and create a transaction.
   * The whole thing runs in a DB transaction so stock and history stay consistent.
   */
  private async checkoutAction(
    itemId: number,
    userId: number,
    qty: number,
    action: 'take' | 'borrow',
    notes?: string,
  ) {
    return this.db.transaction(async (client) => {
      // Decrement stock only if enough is available (atomic check).
      const update = await client.query(
        `UPDATE items
         SET qty_available = qty_available - $1
         WHERE id = $2 AND qty_available >= $1
         RETURNING id, qty_available`,
        [qty, itemId],
      );

      if (update.rowCount === 0) {
        // Either the item does not exist, or not enough stock.
        const exists = await client.query('SELECT qty_available FROM items WHERE id = $1', [itemId]);
        if (exists.rowCount === 0) throw new NotFoundException(`Item ${itemId} not found`);
        throw new BadRequestException('Not enough quantity available');
      }

      // 'active' means the item is currently out (borrowed, or taken away).
      const tx = await client.query(
        `INSERT INTO item_transactions (item_id, user_id, action, status, qty, notes)
         VALUES ($1, $2, $3, 'active', $4, $5)
         RETURNING id, created_at`,
        [itemId, userId, action, qty, notes ?? null],
      );

      return {
        transaction_id: tx.rows[0].id,
        item_id: itemId,
        action,
        qty,
        qty_available: update.rows[0].qty_available,
      };
    });
  }

  /**
   * Return a borrowed item: mark the user's active borrow as returned and give the stock back.
   */
  async returnItem(itemId: number, userId: number, qty: number, notes?: string, borrowId?: number) {
    return this.db.transaction(async (client) => {
      // Find the borrow to return (a specific one, or the most recent active).
      const borrow = await this.findActiveBorrow(client, itemId, userId, borrowId);

      if (borrow.rowCount === 0) {
        throw new BadRequestException('No active borrow found for this item');
      }

      // Return the requested quantity, capped at what the borrow holds.
      const held = borrow.rows[0].qty;
      const returnQty = qty && qty > 0 ? qty : held;
      if (returnQty > held) {
        throw new BadRequestException(`You can return at most ${held} (the quantity you borrowed)`);
      }

      // Close the borrow and give the returned quantity back to stock.
      await client.query(
        `UPDATE item_transactions SET status = 'returned' WHERE id = $1`,
        [borrow.rows[0].id],
      );
      const update = await client.query(
        `UPDATE items SET qty_available = qty_available + $1 WHERE id = $2
         RETURNING qty_available`,
        [returnQty, itemId],
      );

      // Log the return, linked to the borrow it closed (for a clean undo).
      const tx = await client.query(
        `INSERT INTO item_transactions (item_id, user_id, action, status, qty, notes, source_tx_id)
         VALUES ($1, $2, 'return', 'returned', $3, $4, $5)
         RETURNING id`,
        [itemId, userId, returnQty, notes ?? null, borrow.rows[0].id],
      );

      // Partial return: keep the remainder as a fresh active borrow.
      const remainder = held - returnQty;
      if (remainder > 0) {
        await client.query(
          `INSERT INTO item_transactions (item_id, user_id, action, status, qty, source_tx_id)
           VALUES ($1, $2, 'borrow', 'active', $3, $4)`,
          [itemId, userId, remainder, tx.rows[0].id],
        );
      }

      return {
        transaction_id: tx.rows[0].id,
        item_id: itemId,
        action: 'return',
        qty: returnQty,
        qty_available: update.rows[0].qty_available,
      };
    });
  }

  /**
   * Report items as broken. Two cases, decided automatically:
   *  - the user has an active borrow of this item → that borrow broke while out
   *    (mark it 'broken', keep the stock unchanged — it never comes back);
   *  - otherwise → an available item on the shelf is broken
   *    (remove it from the available stock).
   * Both log a 'breakdown' / 'broken' transaction for the history.
   */
  async breakdown(itemId: number, userId: number, qty: number, notes?: string, borrowId?: number) {
    return this.db.transaction(async (client) => {
      // Case B — did this user borrow this item and still has it out?
      // (A specific borrow can be targeted from the "My Borrows" screen.)
      const borrow = await this.findActiveBorrow(client, itemId, userId, borrowId);

      if (borrow.rowCount && borrow.rowCount > 0) {
        // Break the requested quantity, capped at what the borrow holds.
        const held = borrow.rows[0].qty;
        const brokenQty = qty && qty > 0 ? qty : held;
        if (brokenQty > held) {
          throw new BadRequestException(`You can report at most ${held} broken (the quantity you borrowed)`);
        }

        // Resolve the borrow as broken. Stock stays as-is (item never returns).
        await client.query(
          `UPDATE item_transactions SET status = 'broken' WHERE id = $1`,
          [borrow.rows[0].id],
        );
        const tx = await client.query(
          `INSERT INTO item_transactions (item_id, user_id, action, status, qty, notes, source_tx_id)
           VALUES ($1, $2, 'breakdown', 'broken', $3, $4, $5)
           RETURNING id`,
          [itemId, userId, brokenQty, notes ?? null, borrow.rows[0].id],
        );

        // Partial breakdown: keep the still-good remainder as a fresh borrow.
        const remainder = held - brokenQty;
        if (remainder > 0) {
          await client.query(
            `INSERT INTO item_transactions (item_id, user_id, action, status, qty, source_tx_id)
             VALUES ($1, $2, 'borrow', 'active', $3, $4)`,
            [itemId, userId, remainder, tx.rows[0].id],
          );
        }

        const item = await client.query('SELECT qty_available FROM items WHERE id = $1', [itemId]);
        return {
          transaction_id: tx.rows[0].id,
          item_id: itemId,
          action: 'breakdown',
          source: 'borrow',
          qty: brokenQty,
          qty_available: item.rows[0].qty_available,
        };
      }

      // Case A — an available item is broken: remove it from the stock.
      const update = await client.query(
        `UPDATE items
         SET qty_available = qty_available - $1
         WHERE id = $2 AND qty_available >= $1
         RETURNING qty_available`,
        [qty, itemId],
      );

      if (update.rowCount === 0) {
        const exists = await client.query('SELECT 1 FROM items WHERE id = $1', [itemId]);
        if (exists.rowCount === 0) throw new NotFoundException(`Item ${itemId} not found`);
        throw new BadRequestException('Not enough quantity available');
      }

      const tx = await client.query(
        `INSERT INTO item_transactions (item_id, user_id, action, status, qty, notes)
         VALUES ($1, $2, 'breakdown', 'broken', $3, $4)
         RETURNING id`,
        [itemId, userId, qty, notes ?? null],
      );

      return {
        transaction_id: tx.rows[0].id,
        item_id: itemId,
        action: 'breakdown',
        source: 'stock',
        qty,
        qty_available: update.rows[0].qty_available,
      };
    });
  }

  /**
   * Transfer a borrowed item from one employee to another. The item stays out,
   * so the available stock never moves — it only changes hands.
   *
   * The sender's active borrow is closed ('transferred') and fresh borrows are
   * opened: one for the recipient (the transferred quantity) and, for a partial
   * transfer, one for the sender (the remainder they keep). A 'transfer' row is
   * logged with the recipient (to_user_id); the borrows it creates point back to
   * it (source_tx_id) so the whole thing can be undone cleanly.
   */
  async transfer(itemId: number, fromUserId: number, toUserId: number, qty: number, notes?: string, borrowId?: number) {
    if (toUserId === fromUserId) {
      throw new BadRequestException('You cannot transfer an item to yourself');
    }

    return this.db.transaction(async (client) => {
      const recipient = await client.query('SELECT id FROM users WHERE id = $1', [toUserId]);
      if (recipient.rowCount === 0) throw new NotFoundException(`User ${toUserId} not found`);

      // The sender must currently have this item out on an active borrow
      // (a specific one, or the most recent).
      const borrow = await this.findActiveBorrow(client, itemId, fromUserId, borrowId);
      if (borrow.rowCount === 0) {
        throw new BadRequestException('You have no active borrow of this item to transfer');
      }

      const borrowed = borrow.rows[0].qty;
      if (qty > borrowed) {
        throw new BadRequestException(`You can transfer at most ${borrowed} (the quantity you borrowed)`);
      }

      // Close the sender's borrow (the stock stays out — no qty_available change).
      await client.query(`UPDATE item_transactions SET status = 'transferred' WHERE id = $1`, [borrow.rows[0].id]);

      // Log the transfer, linked to the borrow it closed.
      const transfer = await client.query<{ id: number }>(
        `INSERT INTO item_transactions (item_id, user_id, to_user_id, action, status, qty, notes, source_tx_id)
         VALUES ($1, $2, $3, 'transfer', 'transferred', $4, $5, $6)
         RETURNING id`,
        [itemId, fromUserId, toUserId, qty, notes ?? null, borrow.rows[0].id],
      );
      const transferId = transfer.rows[0].id;

      // Open the recipient's borrow (points back to the transfer for undo).
      await client.query(
        `INSERT INTO item_transactions (item_id, user_id, action, status, qty, source_tx_id)
         VALUES ($1, $2, 'borrow', 'active', $3, $4)`,
        [itemId, toUserId, qty, transferId],
      );

      // Partial transfer: the sender keeps the remainder as a fresh borrow.
      const remainder = borrowed - qty;
      if (remainder > 0) {
        await client.query(
          `INSERT INTO item_transactions (item_id, user_id, action, status, qty, source_tx_id)
           VALUES ($1, $2, 'borrow', 'active', $3, $4)`,
          [itemId, fromUserId, remainder, transferId],
        );
      }

      return {
        transaction_id: transferId,
        item_id: itemId,
        action: 'transfer',
        qty,
        to_user_id: toUserId,
      };
    });
  }

  /**
   * Assign an item to a project (tags the item). The project must be active.
   * Reassigning to a different project is allowed. Logged in the history.
   */
  async assignToProject(itemId: number, userId: number, projectId: number) {
    return this.db.transaction(async (client) => {
      const project = (
        await client.query<{ id: number; status: string }>(
          'SELECT id, status FROM projects WHERE id = $1',
          [projectId],
        )
      ).rows[0];
      if (!project) throw new NotFoundException(`Project ${projectId} not found`);
      if (project.status === 'completed') {
        throw new BadRequestException('This project is completed; assign to an active project');
      }

      const item = (
        await client.query<{ id: number; project_id: number | null }>(
          'SELECT id, project_id FROM items WHERE id = $1',
          [itemId],
        )
      ).rows[0];
      if (!item) throw new NotFoundException(`Item ${itemId} not found`);
      if (item.project_id === projectId) {
        throw new BadRequestException('This item is already assigned to that project');
      }

      await client.query('UPDATE items SET project_id = $1 WHERE id = $2', [projectId, itemId]);
      await client.query(
        `INSERT INTO item_transactions (item_id, user_id, project_id, action, qty)
         VALUES ($1, $2, $3, 'assign_to_project', 1)`,
        [itemId, userId, projectId],
      );
      return { item_id: itemId, action: 'assign_to_project', project_id: projectId };
    });
  }

  /** Release an item from its project (project_id → null). Logged in the history. */
  async releaseFromProject(itemId: number, userId: number) {
    return this.db.transaction(async (client) => {
      const item = (
        await client.query<{ id: number; project_id: number | null }>(
          'SELECT id, project_id FROM items WHERE id = $1',
          [itemId],
        )
      ).rows[0];
      if (!item) throw new NotFoundException(`Item ${itemId} not found`);
      if (!item.project_id) throw new BadRequestException('This item is not assigned to a project');

      await client.query(
        `INSERT INTO item_transactions (item_id, user_id, project_id, action, qty)
         VALUES ($1, $2, $3, 'release_from_project', 1)`,
        [itemId, userId, item.project_id],
      );
      await client.query('UPDATE items SET project_id = NULL WHERE id = $1', [itemId]);
      return { item_id: itemId, action: 'release_from_project', project_id: item.project_id };
    });
  }
}
