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

  async findById(id: number): Promise<Omit<User, 'password_hash'> | null> {
    return this.db.queryOne(
      'SELECT id, email, full_name, user_role FROM users WHERE id = $1',
      [id],
    );
  }

  async findAll() {
    return this.db.query(
      'SELECT id, email, full_name, user_role FROM users ORDER BY full_name',
    );
  }

  /** Minimal directory (id + name) any signed-in user can read, e.g. to pick a transfer recipient. */
  async directory() {
    return this.db.query(
      'SELECT id, full_name FROM users ORDER BY full_name',
    );
  }
}
