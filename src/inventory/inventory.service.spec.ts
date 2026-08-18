import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { DatabaseService } from '../database/database.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let client: { query: jest.Mock };
  let db: { query: jest.Mock; queryOne: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    // A fake DB client whose query() we script call-by-call in each test.
    client = { query: jest.fn() };
    db = {
      query: jest.fn(),
      queryOne: jest.fn(),
      // Run the caller's work with our fake client (no real transaction).
      transaction: jest.fn((work: any) => work(client)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = moduleRef.get(InventoryService);
  });

  describe('borrow', () => {
    it('decrements the stock and logs a transaction', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, qty_available: 9 }] })   // UPDATE
        .mockResolvedValueOnce({ rows: [{ id: 100, created_at: new Date() }] });         // INSERT

      const result = await service.borrow(42, 7, 1);

      expect(result).toMatchObject({ item_id: 42, action: 'borrow', qty: 1, qty_available: 9 });
      // First query is the guarded UPDATE.
      expect(client.query.mock.calls[0][0]).toContain('qty_available = qty_available - $1');
      expect(client.query.mock.calls[0][0]).toContain('qty_available >= $1');
    });

    it('refuses when there is not enough stock', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })            // UPDATE changed nothing
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ qty_available: 0 }] }); // item exists

      await expect(service.borrow(42, 7, 5)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the item does not exist', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // UPDATE changed nothing
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });  // item does not exist

      await expect(service.borrow(999, 7, 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('returnItem', () => {
    it('refuses when there is no active borrow', async () => {
      client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // no active borrow found

      await expect(service.returnItem(42, 7, 1)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks the borrow returned and gives the stock back', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, qty: 1 }] })   // find active borrow
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })                     // UPDATE borrow → returned
        .mockResolvedValueOnce({ rows: [{ qty_available: 10 }] })             // give stock back
        .mockResolvedValueOnce({ rows: [{ id: 101 }] });                      // log return

      const result = await service.returnItem(42, 7, 1);

      expect(result).toMatchObject({ item_id: 42, action: 'return', qty_available: 10 });
    });

    it('returns part of a borrow and keeps the remainder as a fresh borrow', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, qty: 5 }] })   // find active borrow (5)
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })                     // close borrow
        .mockResolvedValueOnce({ rows: [{ qty_available: 12 }] })             // stock += 2
        .mockResolvedValueOnce({ rows: [{ id: 101 }] })                       // log return
        .mockResolvedValueOnce({ rows: [] });                                 // insert remainder borrow

      const result = await service.returnItem(42, 7, 2);

      expect(result).toMatchObject({ action: 'return', qty: 2 });
      expect(client.query).toHaveBeenCalledTimes(5);
      // Remainder borrow: qty 3, for the same user, linked to the return (id 101).
      expect(client.query.mock.calls[4][1]).toEqual([42, 7, 3, 101]);
    });

    it('refuses to return more than the borrow holds', async () => {
      client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, qty: 3 }] });
      await expect(service.returnItem(42, 7, 10)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('breakdown (partial)', () => {
    it('breaks part of a borrow and keeps the good remainder', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, qty: 4 }] })   // active borrow (case B)
        .mockResolvedValueOnce({ rows: [] })                                  // mark broken
        .mockResolvedValueOnce({ rows: [{ id: 101 }] })                       // log breakdown
        .mockResolvedValueOnce({ rows: [] })                                  // insert remainder borrow
        .mockResolvedValueOnce({ rows: [{ qty_available: 9 }] });             // read qty_available

      const result = await service.breakdown(42, 7, 1);

      expect(result).toMatchObject({ action: 'breakdown', source: 'borrow', qty: 1 });
      // Remainder borrow: qty 3, linked to the breakdown row (id 101).
      expect(client.query.mock.calls[3][1]).toEqual([42, 7, 3, 101]);
    });
  });

  describe('transfer', () => {
    it('closes the sender borrow and opens one for the recipient (total)', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] })          // recipient exists
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, qty: 3 }] })  // sender active borrow
        .mockResolvedValueOnce({ rows: [] })                                 // close sender borrow
        .mockResolvedValueOnce({ rows: [{ id: 200 }] })                      // insert transfer row
        .mockResolvedValueOnce({ rows: [] });                                // insert recipient borrow

      const result = await service.transfer(3, 7, 2, 3);

      expect(result).toMatchObject({ item_id: 3, action: 'transfer', qty: 3, to_user_id: 2 });
      // The active-borrow lookup ignores rows that were undone/cancelled.
      expect(client.query.mock.calls[1][0]).toContain('cancelled_at IS NULL');
      // Sender borrow is closed as 'transferred'.
      expect(client.query.mock.calls[2][0]).toContain("status = 'transferred'");
      // Total transfer → no remainder borrow (5 calls only).
      expect(client.query).toHaveBeenCalledTimes(5);
    });

    it('keeps the remainder as a fresh borrow on a partial transfer', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] })          // recipient exists
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, qty: 3 }] })  // sender active borrow (3)
        .mockResolvedValueOnce({ rows: [] })                                 // close sender borrow
        .mockResolvedValueOnce({ rows: [{ id: 200 }] })                      // insert transfer row
        .mockResolvedValueOnce({ rows: [] })                                 // insert recipient borrow (2)
        .mockResolvedValueOnce({ rows: [] });                                // insert remainder borrow (1)

      await service.transfer(3, 7, 2, 2);

      expect(client.query).toHaveBeenCalledTimes(6);
      // The remainder borrow is for the sender, qty 1.
      const remainderParams = client.query.mock.calls[5][1];
      expect(remainderParams).toEqual([3, 7, 1, 200]);
    });

    it('refuses transferring to yourself', async () => {
      await expect(service.transfer(3, 7, 7, 1)).rejects.toBeInstanceOf(BadRequestException);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('refuses when the sender has no active borrow', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] })  // recipient exists
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });          // no active borrow

      await expect(service.transfer(3, 7, 2, 1)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses transferring more than borrowed', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] })          // recipient exists
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, qty: 3 }] }); // borrowed only 3

      await expect(service.transfer(3, 7, 2, 5)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the recipient does not exist', async () => {
      client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // recipient missing

      await expect(service.transfer(3, 7, 999, 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list management', () => {
    it('rejects deleting a location still used by items (without force)', async () => {
      db.queryOne.mockResolvedValueOnce({ count: '2' }); // 2 items use it
      await expect(service.deleteLocation(3)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes an unused location', async () => {
      db.queryOne
        .mockResolvedValueOnce({ count: '0' }) // not used
        .mockResolvedValueOnce({ id: 6 });     // DELETE ... RETURNING id
      await expect(service.deleteLocation(6)).resolves.toEqual({ deleted: true, id: 6 });
    });

    it('force-deletes a location by moving its items to another one', async () => {
      db.queryOne
        .mockResolvedValueOnce({ count: '3' })   // in use
        .mockResolvedValueOnce({ id: 4 });       // target location exists
      client.query
        .mockResolvedValueOnce({ rowCount: 3 })  // UPDATE items → new location
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 3 }] }); // DELETE location

      await expect(service.deleteLocation(3, true, 4)).resolves.toMatchObject({ deleted: true, id: 3, to: 4 });
    });

    it('force-delete refuses without a target location', async () => {
      db.queryOne.mockResolvedValueOnce({ count: '3' }); // in use
      await expect(service.deleteLocation(3, true)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reassigns each item to its chosen location, then deletes the source', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 3 }] }) // source location exists
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 4 }] }) // target for item 10
        .mockResolvedValueOnce({ rowCount: 1 })                    // UPDATE item 10 → 4
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] }) // target for item 11
        .mockResolvedValueOnce({ rowCount: 1 })                    // UPDATE item 11 → 5
        .mockResolvedValueOnce({ rows: [{ c: '0' }] })             // no items left
        .mockResolvedValueOnce({ rowCount: 1 });                   // DELETE source location

      await expect(
        service.reassignAndDeleteLocation(3, [
          { itemId: 10, locationId: 4 },
          { itemId: 11, locationId: 5 },
        ]),
      ).resolves.toEqual({ deleted: true, id: 3, moved: 2 });
    });

    it('reassign-delete rejects an empty assignment list', async () => {
      await expect(service.reassignAndDeleteLocation(3, [])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reassign-delete rejects moving an item back to the source location', async () => {
      client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 3 }] }); // source exists
      await expect(
        service.reassignAndDeleteLocation(3, [{ itemId: 10, locationId: 3 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reassign-delete fails when the source location does not exist', async () => {
      client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // source missing
      await expect(
        service.reassignAndDeleteLocation(9, [{ itemId: 10, locationId: 4 }]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('force-deletes a category by detaching its items', async () => {
      db.queryOne.mockResolvedValueOnce({ '?column?': 1 }); // in use
      client.query
        .mockResolvedValueOnce({ rowCount: 2 })  // UPDATE items SET category_id = NULL
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] }); // DELETE category

      await expect(service.deleteCategory(2, true)).resolves.toMatchObject({ deleted: true, id: 2, detached: true });
    });

    it('force-deletes a category by moving its items to another one', async () => {
      db.queryOne
        .mockResolvedValueOnce({ '?column?': 1 }) // in use
        .mockResolvedValueOnce({ id: 5 });        // target category exists
      client.query
        .mockResolvedValueOnce({ rowCount: 2 })   // UPDATE items → new category
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] }); // DELETE category

      await expect(service.deleteCategory(2, true, 5)).resolves.toMatchObject({ deleted: true, id: 2, movedTo: 5 });
    });

    it('rejects a duplicate location name', async () => {
      db.queryOne.mockResolvedValueOnce({ '?column?': 1 }); // already exists
      await expect(service.createLocation('Lab 01')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects deleting a category still used by items', async () => {
      db.queryOne.mockResolvedValueOnce({ '?column?': 1 });
      await expect(service.deleteCategory(2)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('importCsv', () => {
    it('creates a new item from a CSV row', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 3 }); // resolveLocationId → existing location
      db.query.mockResolvedValueOnce([]);           // no item with this name (byName)
      const csv = 'description,location\nWidget,Lab 01';

      const res = await service.importCsv(csv, 1);

      expect(res).toEqual({ created: 1, updated: 0, errors: [], total: 1 });
      expect(db.query.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO items'))).toBe(true);
    });

    it('updates an existing item when the part_id matches (upsert)', async () => {
      db.queryOne
        .mockResolvedValueOnce({ id: 3 })    // resolveLocationId
        .mockResolvedValueOnce({ id: 99 });  // existing item with this part_id
      db.query.mockResolvedValueOnce([]);    // UPDATE (byName is skipped when part_id matches)
      const csv = 'part_id,description,location\nP1,Widget,Lab 01';

      const res = await service.importCsv(csv, 1);

      expect(res).toMatchObject({ created: 0, updated: 1 });
      expect(db.query.mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE items'))).toBe(true);
    });

    it('updates the same-named item when no part_id matches', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 3 });     // resolveLocationId
      db.query
        .mockResolvedValueOnce([{ id: 42 }])            // byName → exactly one match
        .mockResolvedValueOnce([]);                     // UPDATE
      const csv = 'description,location\nWidget,Lab 01';

      const res = await service.importCsv(csv, 1);

      expect(res).toMatchObject({ created: 0, updated: 1, errors: [] });
    });

    it('reports a row whose name matches several items (ambiguous)', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 3 });        // resolveLocationId
      db.query.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]); // byName → two matches
      const csv = 'description,location\nWidget,Lab 01';

      const res = await service.importCsv(csv, 1);

      expect(res).toMatchObject({ created: 0, updated: 0 });
      expect(res.errors).toHaveLength(1);
    });

    it('reports a row missing required fields instead of aborting', async () => {
      const csv = 'description,location\nWidget,';  // location blank

      const res = await service.importCsv(csv, 1);

      expect(res.created).toBe(0);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toMatchObject({ row: 2 });
    });

    it('rejects a CSV with no data rows', async () => {
      await expect(service.importCsv('description,location', 1)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('imports equipment columns (booleans/dates parsed) into the INSERT', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 3 }); // resolveLocationId
      db.query.mockResolvedValueOnce([]);           // byName → no existing item
      const csv =
        'description,location,serial_number,calibration_required,maintenance_next,calibration_alert_value,calibration_alert_unit\n' +
        'Scope,Lab 01,SN-1,Yes,2026-01-31,30,days';

      const res = await service.importCsv(csv, 1);

      expect(res).toMatchObject({ created: 1, errors: [] });
      const insert = db.query.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO items'));
      expect(String(insert[0])).toContain('serial_number');
      expect(String(insert[0])).toContain('calibration_alert_unit');
      expect(insert[1]).toContain(true);   // calibration_required "Yes" → true
      expect(insert[1]).toContain('days'); // unit kept
    });

    it('reports a row with an invalid date or boolean', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 3 }); // resolveLocationId
      const csv = 'description,location,maintenance_next\nScope,Lab 01,31-01-2026'; // wrong format

      const res = await service.importCsv(csv, 1);

      expect(res).toMatchObject({ created: 0, updated: 0 });
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].message).toMatch(/date/i);
    });

    it('assigns the project named in the CSV', async () => {
      db.queryOne
        .mockResolvedValueOnce({ id: 3 })   // resolveLocationId
        .mockResolvedValueOnce({ id: 8 });  // resolveProjectId → existing project
      db.query.mockResolvedValueOnce([]);   // byName → no existing item
      const csv = 'description,location,project\nWidget,Lab 01,Alpha';

      const res = await service.importCsv(csv, 1);

      expect(res).toMatchObject({ created: 1 });
      const insert = db.query.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO items'));
      expect(String(insert[0])).toContain('project_id');
    });
  });

  describe('projects (assign / release)', () => {
    it('assigns an item to an active project and logs it', async () => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 8, status: 'active' }] })      // project exists, active
        .mockResolvedValueOnce({ rows: [{ id: 3, project_id: null }] })      // item exists, no project
        .mockResolvedValueOnce({ rows: [] })                                  // UPDATE items.project_id
        .mockResolvedValueOnce({ rows: [] });                                 // log assign_to_project

      const res = await service.assignToProject(3, 7, 8);

      expect(res).toMatchObject({ item_id: 3, action: 'assign_to_project', project_id: 8 });
      expect(client.query.mock.calls[3][0]).toContain('assign_to_project');
    });

    it('refuses to assign to a completed project', async () => {
      client.query.mockResolvedValueOnce({ rows: [{ id: 8, status: 'completed' }] });
      await expect(service.assignToProject(3, 7, 8)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to assign an item to the project it is already in', async () => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 8, status: 'active' }] })  // project active
        .mockResolvedValueOnce({ rows: [{ id: 3, project_id: 8 }] });    // already in project 8
      await expect(service.assignToProject(3, 7, 8)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('releases an item from its project', async () => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 3, project_id: 8 }] })  // item is in project 8
        .mockResolvedValueOnce({ rows: [] })                          // log release_from_project
        .mockResolvedValueOnce({ rows: [] });                         // UPDATE items.project_id → null

      const res = await service.releaseFromProject(3, 7);

      expect(res).toMatchObject({ item_id: 3, action: 'release_from_project', project_id: 8 });
    });

    it('refuses to release an item that has no project', async () => {
      client.query.mockResolvedValueOnce({ rows: [{ id: 3, project_id: null }] });
      await expect(service.releaseFromProject(3, 7)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('deleteItem', () => {
    it('blocks deletion of an item that has history', async () => {
      db.queryOne.mockResolvedValueOnce({ '?column?': 1 }); // a transaction exists

      await expect(service.deleteItem(42)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes an item with no history', async () => {
      db.queryOne
        .mockResolvedValueOnce(null)          // no history
        .mockResolvedValueOnce({ id: 42 });   // DELETE ... RETURNING id

      await expect(service.deleteItem(42)).resolves.toEqual({ deleted: true, id: 42 });
    });
  });
});
