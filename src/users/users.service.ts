import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  user_role: 'admin' | 'manager' | 'employee';
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT id, email, password_hash, full_name, user_role FROM users WHERE email = $1',
      [email],
    );
  }

  /**
   * Resolves the local numeric user id for a Cognito identity, provisioning the
   * row on first sign-in. Matched first by cognito_sub, then by email (an
   * existing row gets linked); otherwise a new row is created. Returns the id.
   */
  async resolveUserId(params: {
    sub: string;
    email: string;
    fullName: string;
    role: 'admin' | 'manager' | 'employee';
  }): Promise<number> {
    const bySub = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM users WHERE cognito_sub = $1',
      [params.sub],
    );
    if (bySub) return bySub.id;

    const byEmail = await this.db.queryOne<{ id: number }>(
      'SELECT id FROM users WHERE email = $1',
      [params.email],
    );
    if (byEmail) {
      await this.db.query('UPDATE users SET cognito_sub = $1 WHERE id = $2', [params.sub, byEmail.id]);
      return byEmail.id;
    }

    // Just-in-time provisioning. Password is unused (Cognito handles auth).
    const created = await this.db.queryOne<{ id: number }>(
      `INSERT INTO users (email, password_hash, full_name, user_role, cognito_sub)
       VALUES ($1, '', $2, $3, $4)
       RETURNING id`,
      [params.email, params.fullName, params.role, params.sub],
    );
    return created!.id;
  }

  async findById(id: number): Promise<Omit<User, 'password_hash'> | null> {
    return this.db.queryOne(
      'SELECT id, email, full_name, user_role FROM users WHERE id = $1',
      [id],
    );
  }

  async findAll() {
    return this.db.query(
      `SELECT u.id, u.email, u.full_name, u.user_role AS role,
         COALESCE((
           SELECT json_agg(json_build_object(
             'item_id', i.id, 'part_id', i.part_id, 'item', i.description,
             'location', l.name, 'qty', t.qty, 'since', t.created_at
           ) ORDER BY t.created_at DESC)
           FROM item_transactions t
           JOIN items i ON t.item_id = i.id
           JOIN locations l ON i.location_id = l.id
           WHERE t.user_id = u.id AND t.action = 'borrow'
             AND t.status = 'active' AND t.cancelled_at IS NULL
         ), '[]'::json) AS holdings
       FROM users u
       ORDER BY u.full_name`,
    );
  }

  /** Basic profile of one user (admin's user-details page). */
  async findOneBasic(id: number) {
    return this.db.queryOne(
      'SELECT id, email, full_name, user_role AS role FROM users WHERE id = $1',
      [id],
    );
  }

  /** Minimal directory (id + name) any signed-in user can read, e.g. to pick a transfer recipient. */
  async directory() {
    return this.db.query(
      'SELECT id, full_name FROM users ORDER BY full_name',
    );
  }
}
