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
}
