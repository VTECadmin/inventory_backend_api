import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Health probe (public): confirms the process is up and the database is
   * reachable. Returns 503 when the database cannot be queried, so monitoring
   * and deployment checks can detect a degraded instance.
   */
  @Get('health')
  async health() {
    try {
      await this.db.queryOne('SELECT 1');
      return { status: 'ok', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: 'down' });
    }
  }
}
