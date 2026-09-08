import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  /** All projects with their status, creator and how many items they hold. */
  async findAll() {
    return this.db.query(
      `SELECT p.id, p.name, p.status,
              u.full_name AS created_by_name,
              COUNT(i.id) AS item_count
       FROM projects p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN items i ON i.project_id = p.id
       WHERE p.deleted_at IS NULL
       GROUP BY p.id, p.name, p.status, u.full_name
       ORDER BY p.name`,
    );
  }

  /** The items currently assigned to a project. */
  async items(projectId: number) {
    return this.db.query(
      `SELECT i.id, i.description, l.name AS location
       FROM items i
       JOIN locations l ON i.location_id = l.id
       WHERE i.project_id = $1
       ORDER BY i.description`,
      [projectId],
    );
  }

  async create(name: string, userId: number) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Project name is required');
    return this.db.queryOne(
      'INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id, name, status',
      [clean, userId],
    );
  }

  /**
   * Release the given items from a project (project_id → null) — a project need
   * not be finished to release items. Only items actually in the project are
   * released; each is logged as 'release_from_project'. All-or-nothing.
   */
  async releaseItems(projectId: number, userId: number, itemIds: number[]) {
    if (!itemIds || itemIds.length === 0) throw new BadRequestException('No items selected');

    return this.db.transaction(async (client) => {
      // Keep only the ids that really belong to this project.
      const inProject = await client.query<{ id: number }>(
        'SELECT id FROM items WHERE project_id = $1 AND id = ANY($2::int[])',
        [projectId, itemIds],
      );
      for (const item of inProject.rows) {
        await client.query(
          `INSERT INTO item_transactions (item_id, user_id, project_id, action, qty)
           VALUES ($1, $2, $3, 'release_from_project', 1)`,
          [item.id, userId, projectId],
        );
      }
      await client.query(
        'UPDATE items SET project_id = NULL WHERE project_id = $1 AND id = ANY($2::int[])',
        [projectId, itemIds],
      );
      return { released: inProject.rowCount };
    });
  }

  /** Release every item currently in the project (one-click "Release all"). */
  async releaseAll(projectId: number, userId: number) {
    return this.db.transaction(async (client) => {
      const items = await client.query<{ id: number }>('SELECT id FROM items WHERE project_id = $1', [projectId]);
      for (const item of items.rows) {
        await client.query(
          `INSERT INTO item_transactions (item_id, user_id, project_id, action, qty)
           VALUES ($1, $2, $3, 'release_from_project', 1)`,
          [item.id, userId, projectId],
        );
      }
      await client.query('UPDATE items SET project_id = NULL WHERE project_id = $1', [projectId]);
      return { released: items.rowCount };
    });
  }

  /**
   * Mark a project active or completed. Completing it releases any items still
   * assigned (a finished project shouldn't keep holding equipment) — logged as
   * 'release_from_project', all in one transaction. Reopening just flips the flag.
   */
  async setStatus(projectId: number, userId: number, status: string) {
    if (status !== 'active' && status !== 'completed') {
      throw new BadRequestException('Status must be "active" or "completed"');
    }
    return this.db.transaction(async (client) => {
      let released = 0;
      if (status === 'completed') {
        const items = await client.query<{ id: number }>('SELECT id FROM items WHERE project_id = $1', [projectId]);
        for (const item of items.rows) {
          await client.query(
            `INSERT INTO item_transactions (item_id, user_id, project_id, action, qty)
             VALUES ($1, $2, $3, 'release_from_project', 1)`,
            [item.id, userId, projectId],
          );
        }
        await client.query('UPDATE items SET project_id = NULL WHERE project_id = $1', [projectId]);
        released = items.rowCount ?? 0;
      }
      const row = await client.query(
        'UPDATE projects SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, name, status',
        [status, projectId],
      );
      if (row.rowCount === 0) throw new NotFoundException('Project not found');
      return { ...row.rows[0], released };
    });
  }

  /** Rename a project. */
  async rename(projectId: number, name: string) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Project name is required');
    const row = await this.db.queryOne(
      'UPDATE projects SET name = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, name, status',
      [clean, projectId],
    );
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  /**
   * Soft-delete a project. Any items still assigned are released first (logged as
   * 'release_from_project') so nothing is left pointing at a hidden project, then
   * we mark deleted_at rather than DELETE the row so its past assign/release
   * transactions stay valid. All-or-nothing.
   */
  async remove(projectId: number, userId: number) {
    return this.db.transaction(async (client) => {
      const items = await client.query<{ id: number }>('SELECT id FROM items WHERE project_id = $1', [projectId]);
      for (const item of items.rows) {
        await client.query(
          `INSERT INTO item_transactions (item_id, user_id, project_id, action, qty)
           VALUES ($1, $2, $3, 'release_from_project', 1)`,
          [item.id, userId, projectId],
        );
      }
      await client.query('UPDATE items SET project_id = NULL WHERE project_id = $1', [projectId]);

      const row = await client.query(
        'UPDATE projects SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
        [projectId],
      );
      if (row.rowCount === 0) throw new NotFoundException('Project not found');
      return { deleted: true, released: items.rowCount };
    });
  }
}
