import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';

describe('AppController', () => {
  let appController: AppController;
  let db: { queryOne: jest.Mock };

  beforeEach(async () => {
    db = { queryOne: jest.fn() };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DatabaseService, useValue: db }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('reports ok when the database responds', async () => {
      db.queryOne.mockResolvedValueOnce({ '?column?': 1 });
      await expect(appController.health()).resolves.toEqual({ status: 'ok', db: 'up' });
    });

    it('returns 503 when the database is unreachable', async () => {
      db.queryOne.mockRejectedValueOnce(new Error('connection refused'));
      await expect(appController.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
