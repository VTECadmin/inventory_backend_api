import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CognitoDirectoryService } from './cognito-directory.service';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  user_role: 'admin' | 'manager' | 'employee';
}

interface LocalUserRow {
  id: number;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'employee';
  cognito_sub: string | null;
  holdings: any[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cognito: CognitoDirectoryService,
  ) {}

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

  /**
   * The Users directory. Master list is the whole Cognito user pool (same people
   * the dashboard's Team page shows), each with their inventory role (from group
   * membership) and any items they hold. Users who never used the inventory have
   * no local row: they appear with id=null and no holdings. When the Cognito
   * directory is unavailable (no IAM/credentials), it falls back to the local
   * users table so the page keeps working.
   */
  async findAll() {
    const local = await this.db.query<LocalUserRow>(
      `SELECT u.id, u.email, u.full_name, u.user_role AS role, u.cognito_sub,
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

    const pool = await this.cognito.listPoolUsers();
    if (!pool) {
      // Degraded mode: only the users provisioned in the inventory.
      return local.map(({ cognito_sub, ...u }) => u);
    }

    const bySub = new Map(local.filter((u) => u.cognito_sub).map((u) => [u.cognito_sub!, u]));
    const byEmail = new Map(local.map((u) => [u.email.toLowerCase(), u]));

    const merged = pool.map((p) => {
      const match =
        (p.sub && bySub.get(p.sub)) || (p.email && byEmail.get(p.email.toLowerCase())) || null;
      return {
        id: match?.id ?? null,
        email: p.email || match?.email || '',
        full_name: p.name || match?.full_name || p.email,
        role: p.role, // Cognito group membership is authoritative
        holdings: match?.holdings ?? [],
      };
    });

    // Keep any local user no longer present in the pool (e.g. removed from
    // Cognito but still owning history) so their data is not lost.
    const poolSubs = new Set(pool.map((p) => p.sub).filter(Boolean));
    const poolEmails = new Set(pool.map((p) => p.email.toLowerCase()).filter(Boolean));
    for (const u of local) {
      const inPool =
        (u.cognito_sub && poolSubs.has(u.cognito_sub)) || poolEmails.has(u.email.toLowerCase());
      if (!inPool) {
        merged.push({
          id: u.id,
          email: u.email,
          full_name: u.full_name,
          role: u.role,
          holdings: u.holdings,
        });
      }
    }

    merged.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    return merged;
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
