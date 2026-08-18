import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from '../auth/current-user.decorator';

@Injectable()
export class TransactionsService {
  constructor(private readonly db: DatabaseService) {}

  private readonly SELECT_SQL = `
    SELECT
      tx.id,
      tx.user_id,
      tx.item_id,
      i.description AS item,
      u.full_name   AS "user",
      tx.action,
      tx.qty,
      tx.status,
      tx.created_at,
      tx.cancelled_at,
      cu.full_name AS cancelled_by_name,
      tx.to_user_id,
      tu.full_name AS to_user_name,
      tx.source_tx_id,
      -- On the recipient's borrow (the one a transfer created for them),
      -- expose who transferred it so their history reads "received from A".
      CASE WHEN st.to_user_id = tx.user_id THEN su.full_name END AS from_user_name
    FROM item_transactions tx
    JOIN items i ON tx.item_id = i.id
    JOIN users u ON tx.user_id = u.id
    LEFT JOIN users cu ON tx.cancelled_by = cu.id
    LEFT JOIN users tu ON tx.to_user_id = tu.id
    LEFT JOIN item_transactions st ON tx.source_tx_id = st.id AND st.action = 'transfer'
    LEFT JOIN users su ON st.user_id = su.id
  `;

  /** Builds the RBAC + optional filters shared by findAll and findPage. */
  private buildWhere(
    user: AuthUser,
    filters: { itemId?: number; userId?: number; itemSearch?: string; action?: string } = {},
  ) {
    const conditions: string[] = [];
    const params: any[] = [];
    // RBAC: an employee only sees their own transactions; admin/manager see all
    // and may filter by a specific person.
    if (user.role === 'employee') {
      params.push(user.id);
      conditions.push(`tx.user_id = $${params.length}`);
    } else if (filters.userId) {
      params.push(filters.userId);
      conditions.push(`tx.user_id = $${params.length}`);
    }
    if (filters.itemId) {
      params.push(filters.itemId);
      conditions.push(`tx.item_id = $${params.length}`);
    }
    if (filters.itemSearch) {
      params.push(`%${filters.itemSearch}%`);
      conditions.push(`i.description ILIKE $${params.length}`);
    }
    if (filters.action) {
      params.push(filters.action);
      conditions.push(`tx.action = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { where, params };
  }

  /** All matching transactions (no pagination) — used by export and the item page. */
  async findAll(
    user: AuthUser,
    filters: { itemId?: number; userId?: number; itemSearch?: string; action?: string } = {},
  ) {
    const { where, params } = this.buildWhere(user, filters);
    return this.db.query(`${this.SELECT_SQL} ${where} ORDER BY tx.created_at DESC`, params);
  }

  /** One page of transactions, with the total count — used by the history page. */
  async findPage(
    user: AuthUser,
    { page = 1, limit = 50, userId, itemSearch, action }:
      { page?: number; limit?: number; userId?: number; itemSearch?: string; action?: string },
  ) {
    const { where, params } = this.buildWhere(user, { userId, itemSearch, action });
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const sql = `
      SELECT sub.*, COUNT(*) OVER() AS _total
      FROM (${this.SELECT_SQL} ${where}) sub
      ORDER BY sub.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const rows = await this.db.query<any>(sql, params);
    const total = rows.length > 0 ? Number(rows[0]._total) : 0;
    const data = rows.map(({ _total, ...r }) => r);
    return { data, total, page, limit };
  }

  /**
   * The borrows a user currently has out — one row per active borrow (someone
   * may hold the same item on several borrows). Each row carries its own borrow
   * id. Powers "My Borrows" and the admin's per-user holdings view.
   */
  async holdingsOf(userId: number) {
    return this.db.query(
      `SELECT
         tx.id,
         tx.item_id,
         i.description AS item,
         l.name AS location,
         tx.qty,
         tx.created_at AS since
       FROM item_transactions tx
       JOIN items i ON tx.item_id = i.id
       JOIN locations l ON i.location_id = l.id
       WHERE tx.user_id = $1 AND tx.action = 'borrow'
         AND tx.status = 'active' AND tx.cancelled_at IS NULL
       ORDER BY tx.created_at DESC`,
      [userId],
    );
  }

  /** The current user's own active borrows (used by "My Borrows"). */
  async myBorrows(user: AuthUser) {
    return this.holdingsOf(user.id);
  }

  /** Builds a CSV of the transactions the user is allowed to see (honouring filters). */
  async exportCsv(
    user: AuthUser,
    filters: { userId?: number; itemSearch?: string; action?: string } = {},
  ) {
    const rows = await this.findAll(user, filters);

    const columns = ['id', 'created_at', 'item', 'user', 'action', 'qty', 'status'];
    const escape = (value: any) => {
      if (value === null || value === undefined) return '';
      const s = value instanceof Date ? value.toISOString() : String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [columns.join(',')];
    for (const row of rows as any[]) {
      lines.push(columns.map((col) => escape(row[col])).join(','));
    }
    return lines.join('\n');
  }

  /**
   * Undo an action the user made by mistake. Users can only undo their own,
   * and each action can be undone once. The reversal depends on the action:
   *   - take / borrow   → give the quantity back to stock
   *   - return          → take the stock back out and reopen the borrow it closed
   *   - breakdown       → restore the broken borrow, or give shelf stock back
   * The record is kept in the history and marked as cancelled (who + when).
   */
  async undoTransaction(txId: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const tx = (
        await client.query<{
          id: number; item_id: number; user_id: number;
          action: string; status: string; qty: number;
          cancelled_at: Date | null; source_tx_id: number | null;
        }>(
          `SELECT id, item_id, user_id, action, status, qty, cancelled_at, source_tx_id
           FROM item_transactions WHERE id = $1`,
          [txId],
        )
      ).rows[0];

      if (!tx) throw new BadRequestException('Transaction not found');
      if (tx.user_id !== user.id) {
        throw new ForbiddenException('You can only undo your own actions');
      }
      if (tx.cancelled_at) {
        throw new BadRequestException('This action has already been undone');
      }

      const giveStockBack = () =>
        client.query(`UPDATE items SET qty_available = qty_available + $1 WHERE id = $2`, [tx.qty, tx.item_id]);

      const restoreBrokenBorrow = async () => {
        const borrow = (
          await client.query<{ id: number }>(
            `SELECT id FROM item_transactions
             WHERE item_id = $1 AND user_id = $2 AND action = 'borrow'
               AND status = $3 AND cancelled_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [tx.item_id, tx.user_id, 'broken'],
          )
        ).rows[0];
        return borrow;
      };

      // Reverse a return / breakdown / transfer that was recorded with links:
      // reopen the borrow it closed (source_tx_id) and void the borrows it
      // created (the remainder, or a transfer's recipient borrow). Refuses if
      // any of those has since been acted on. Stock is handled by the caller.
      const reopenSourceAndVoidChildren = async () => {
        const children = await client.query<{ id: number; status: string; cancelled_at: Date | null }>(
          `SELECT id, status, cancelled_at FROM item_transactions WHERE source_tx_id = $1`,
          [tx.id],
        );
        const moved = children.rows.some((c) => c.status !== 'active' || c.cancelled_at);
        if (moved) {
          throw new BadRequestException('This item was already acted on afterwards; undo that first');
        }
        if (tx.source_tx_id) {
          await client.query(`UPDATE item_transactions SET status = 'active' WHERE id = $1`, [tx.source_tx_id]);
        }
        for (const child of children.rows) {
          await client.query(
            `UPDATE item_transactions SET cancelled_at = NOW(), cancelled_by = $1 WHERE id = $2`,
            [user.id, child.id],
          );
        }
      };

      switch (tx.action) {
        case 'take':
          await giveStockBack();
          break;

        case 'borrow':
          if (tx.source_tx_id) {
            // This borrow was created by a transfer, not a direct checkout, so
            // the stock was never decremented for it — undo the transfer instead.
            throw new BadRequestException('This item was received via a transfer; undo the transfer instead');
          }
          if (tx.status !== 'active') {
            throw new BadRequestException(
              'This borrow was already returned or reported broken; undo that action instead',
            );
          }
          await giveStockBack();
          break;

        case 'return': {
          // Take the returned quantity back out of stock (must be available)…
          const upd = await client.query(
            `UPDATE items SET qty_available = qty_available - $1
             WHERE id = $2 AND qty_available >= $1 RETURNING id`,
            [tx.qty, tx.item_id],
          );
          if (upd.rowCount === 0) throw new BadRequestException('Not enough stock to undo this return');

          if (tx.source_tx_id) {
            // …reopen the borrow it closed and void any remainder it created.
            await reopenSourceAndVoidChildren();
          } else {
            // Legacy return (no link): reopen the most-recent returned borrow.
            const borrow = (
              await client.query<{ id: number }>(
                `SELECT id FROM item_transactions
                 WHERE item_id = $1 AND user_id = $2 AND action = 'borrow'
                   AND status = 'returned' AND cancelled_at IS NULL
                 ORDER BY created_at DESC LIMIT 1`,
                [tx.item_id, tx.user_id],
              )
            ).rows[0];
            if (borrow) await client.query(`UPDATE item_transactions SET status = 'active' WHERE id = $1`, [borrow.id]);
          }
          break;
        }

        case 'breakdown': {
          if (tx.source_tx_id) {
            // A borrowed item broke: reopen the borrow, void any remainder.
            // Stock never moved, so nothing to give back.
            await reopenSourceAndVoidChildren();
          } else {
            // Legacy / shelf breakdown: reopen a broken borrow, or give stock back.
            const borrow = await restoreBrokenBorrow();
            if (borrow) {
              await client.query(`UPDATE item_transactions SET status = 'active' WHERE id = $1`, [borrow.id]);
            } else {
              await giveStockBack();
            }
          }
          break;
        }

        case 'transfer':
          // Reopen the sender's original borrow and void the borrows the
          // transfer created (recipient's + the sender's remainder). Stock never
          // moved during a transfer, so there is nothing to adjust here.
          await reopenSourceAndVoidChildren();
          break;

        default:
          throw new BadRequestException('This action cannot be undone');
      }

      // Keep the record for traceability, but mark it as cancelled (who + when).
      await client.query(
        `UPDATE item_transactions SET cancelled_at = NOW(), cancelled_by = $1 WHERE id = $2`,
        [user.id, txId],
      );

      return { undone: true, id: txId };
    });
  }
}
