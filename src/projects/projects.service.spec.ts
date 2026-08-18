import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
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
        ProjectsService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  describe('create', () => {
    it('rejects a blank name', async () => {
      await expect(service.create('   ', 1)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('inserts a project for the creator', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 5, name: 'Alpha', status: 'active' });
      await expect(service.create('Alpha', 1)).resolves.toMatchObject({ id: 5, status: 'active' });
    });
  });

  describe('releaseItems', () => {
    it('releases the selected items that belong to the project and logs each', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 1 }, { id: 2 }] }) // items in project ∩ selected
        .mockResolvedValueOnce({ rows: [] })   // log release item 1
        .mockResolvedValueOnce({ rows: [] })   // log release item 2
        .mockResolvedValueOnce({ rows: [] });  // UPDATE items → project_id null

      const res = await service.releaseItems(5, 9, [1, 2, 999]);

      expect(res).toEqual({ released: 2 });
      // Only items in the project are detached.
      expect(client.query.mock.calls[3][0]).toContain('project_id = NULL');
      expect(client.query.mock.calls[0][0]).toContain('project_id = $1 AND id = ANY');
    });

    it('rejects an empty selection', async () => {
      await expect(service.releaseItems(5, 9, [])).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('releaseAll', () => {
    it('releases every item in the project and logs each', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 3, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }) // items in project
        .mockResolvedValueOnce({ rows: [] })   // log 1
        .mockResolvedValueOnce({ rows: [] })   // log 2
        .mockResolvedValueOnce({ rows: [] })   // log 3
        .mockResolvedValueOnce({ rows: [] });  // UPDATE items → project_id null

      const res = await service.releaseAll(5, 9);

      expect(res).toEqual({ released: 3 });
      expect(client.query.mock.calls[4][0]).toContain('project_id = NULL');
    });
  });
});
