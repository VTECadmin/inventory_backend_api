import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from '../auth/current-user.decorator';

const employee: AuthUser = { id: 7, email: 'e@vtec.com', role: 'employee' };
const admin: AuthUser = { id: 1, email: 'a@vtec.com', role: 'admin' };

describe('TransactionsService', () => {
  let service: TransactionsService;
  let client: { query: jest.Mock };
  let db: { query: jest.Mock; queryOne: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    client = { query: jest.fn() };
    db = {
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn(),
      transaction: jest.fn((work: any) => work(client)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = moduleRef.get(TransactionsService);
  });

  describe('findAll RBAC', () => {
    it('restricts an employee to their own transactions', async () => {
      await service.findAll(employee);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('tx.user_id = $1');
      expect(params).toEqual([employee.id]);
    });

    it('does not filter by user for an admin', async () => {
      await service.findAll(admin);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).not.toContain('WHERE');
      expect(params).toEqual([]);
    });

    it('combines the item filter with the employee filter', async () => {
      await service.findAll(employee, { itemId: 42 });

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('tx.user_id = $1');
      expect(sql).toContain('tx.item_id = $2');
      expect(params).toEqual([employee.id, 42]);
    });
  });

  describe('findPage', () => {
    it('returns one page with the total count and strips the helper column', async () => {
      db.query.mockResolvedValueOnce([
        { id: 1, _total: '120' },
        { id: 2, _total: '120' },
      ]);

      const res = await service.findPage(admin, { page: 2, limit: 50 });

      expect(res).toMatchObject({ total: 120, page: 2, limit: 50 });
      expect(res.data).toHaveLength(2);
      expect((res.data[0] as any)._total).toBeUndefined();
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('COUNT(*) OVER()');
      expect(params).toEqual([50, 50]); // limit, offset (page 2 → offset 50)
    });

    it('applies the employee RBAC filter when paginating', async () => {
      db.query.mockResolvedValueOnce([]);
      await service.findPage(employee, { page: 1, limit: 50 });

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('tx.user_id = $1');
      expect(params).toEqual([employee.id, 50, 0]);
    });

    it('lets a manager/admin filter by a specific person, item and action', async () => {
      db.query.mockResolvedValueOnce([]);
      await service.findPage(admin, { page: 1, limit: 50, userId: 3, itemSearch: 'laser', action: 'borrow' });

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('tx.user_id = $1');
      expect(sql).toContain('i.description ILIKE $2');
      expect(sql).toContain('tx.action = $3');
      expect(params).toEqual([3, '%laser%', 'borrow', 50, 0]);
    });

    it('ignores a userId filter for an employee (RBAC — locked to self)', async () => {
      db.query.mockResolvedValueOnce([]);
      await service.findPage(employee, { page: 1, limit: 50, userId: 1 });

      const [, params] = db.query.mock.calls[0];
      // Locked to the employee's own id, not the requested 1.
      expect(params).toEqual([employee.id, 50, 0]);
    });
  });

  describe('myBorrows', () => {
    it('returns the active, non-cancelled borrows of the current user', async () => {
      await service.myBorrows(employee);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain("action = 'borrow'");
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain('cancelled_at IS NULL');
      expect(sql).toContain('tx.user_id = $1');
      expect(params).toEqual([employee.id]);
    });
  });

  describe('undoTransaction', () => {
    it('undoes a take by giving the stock back and marking it cancelled', async () => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 5, action: 'take', status: 'active', user_id: 7, item_id: 3, qty: 2, cancelled_at: null }] }) // SELECT tx
        .mockResolvedValueOnce({ rows: [] })   // give stock back
        .mockResolvedValueOnce({ rows: [] });  // mark cancelled

      await expect(service.undoTransaction(5, employee)).resolves.toEqual({ undone: true, id: 5 });
    });

    it('refuses to undo an action made by someone else', async () => {
      client.query.mockResolvedValueOnce({ rows: [{ id: 5, action: 'take', status: 'active', user_id: 999, item_id: 3, qty: 1 }] });

      await expect(service.undoTransaction(5, employee)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to undo an action that was already undone', async () => {
      client.query.mockResolvedValueOnce({
        rows: [{ id: 5, action: 'take', status: 'active', user_id: 7, item_id: 3, qty: 1, cancelled_at: new Date() }],
      });

      await expect(service.undoTransaction(5, employee)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to undo a borrow that was already returned', async () => {
      client.query.mockResolvedValueOnce({
        rows: [{ id: 5, action: 'borrow', status: 'returned', user_id: 7, item_id: 3, qty: 1, cancelled_at: null }],
      });

      await expect(service.undoTransaction(5, employee)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('undoes a transfer by reopening the original borrow and voiding the ones it created', async () => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 200, action: 'transfer', status: 'transferred', user_id: 7, item_id: 3, qty: 2, cancelled_at: null, source_tx_id: 5 }] }) // SELECT tx
        .mockResolvedValueOnce({ rows: [{ id: 201, status: 'active', cancelled_at: null }, { id: 202, status: 'active', cancelled_at: null }] }) // children
        .mockResolvedValueOnce({ rows: [] })  // reopen original borrow
        .mockResolvedValueOnce({ rows: [] })  // cancel child 201
        .mockResolvedValueOnce({ rows: [] })  // cancel child 202
        .mockResolvedValueOnce({ rows: [] }); // mark transfer cancelled

      await expect(service.undoTransaction(200, employee)).resolves.toEqual({ undone: true, id: 200 });
      // The original borrow (source_tx_id) is set back to active.
      expect(client.query.mock.calls[2][0]).toContain("status = 'active'");
      expect(client.query.mock.calls[2][1]).toEqual([5]);
    });

    it('undoes a partial return: takes stock back, reopens the borrow, voids the remainder', async () => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 300, action: 'return', status: 'returned', user_id: 7, item_id: 3, qty: 2, cancelled_at: null, source_tx_id: 5 }] }) // SELECT tx
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 3 }] })  // UPDATE items qty_available -= 2
        .mockResolvedValueOnce({ rows: [{ id: 301, status: 'active', cancelled_at: null }] }) // remainder child
        .mockResolvedValueOnce({ rows: [] })  // reopen source borrow (id 5)
        .mockResolvedValueOnce({ rows: [] })  // cancel remainder 301
        .mockResolvedValueOnce({ rows: [] }); // mark return cancelled

      await expect(service.undoTransaction(300, employee)).resolves.toEqual({ undone: true, id: 300 });
      // Reopened the borrow the return had closed.
      expect(client.query.mock.calls[3][1]).toEqual([5]);
    });

    it('refuses to undo a transfer the recipient already acted on', async () => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 200, action: 'transfer', status: 'transferred', user_id: 7, item_id: 3, qty: 2, cancelled_at: null, source_tx_id: 5 }] }) // SELECT tx
        .mockResolvedValueOnce({ rows: [{ id: 201, status: 'returned', cancelled_at: null }] }); // a child already returned

      await expect(service.undoTransaction(200, employee)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to undo a borrow that came from a transfer', async () => {
      client.query.mockResolvedValueOnce({
        rows: [{ id: 201, action: 'borrow', status: 'active', user_id: 7, item_id: 3, qty: 2, cancelled_at: null, source_tx_id: 200 }],
      });

      await expect(service.undoTransaction(201, employee)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
