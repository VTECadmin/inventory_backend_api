import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  describe('setStatus', () => {
    it('rejects an invalid status', async () => {
      await expect(service.setStatus(5, 9, 'archived')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completing a project releases its items and reports the count', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 1 }, { id: 2 }] }) // items in project
        .mockResolvedValueOnce({ rows: [] }) // log release 1
        .mockResolvedValueOnce({ rows: [] }) // log release 2
        .mockResolvedValueOnce({ rows: [] }) // UPDATE items → project_id null
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, name: 'Alpha', status: 'completed' }] });

      const res = await service.setStatus(5, 9, 'completed');

      expect(res).toMatchObject({ id: 5, status: 'completed', released: 2 });
      expect(client.query.mock.calls[3][0]).toContain('project_id = NULL');
    });

    it('reopening a project releases nothing', async () => {
      client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, name: 'Alpha', status: 'active' }] });

      const res = await service.setStatus(5, 9, 'active');

      expect(res).toMatchObject({ status: 'active', released: 0 });
      expect(client.query).toHaveBeenCalledTimes(1); // no release path
    });

    it('throws NotFound when the project is missing', async () => {
      client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // UPDATE changed nothing
      await expect(service.setStatus(5, 9, 'active')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rename', () => {
    it('rejects a blank name', async () => {
      await expect(service.rename(5, '  ')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('renames and returns the project', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 5, name: 'Beta', status: 'active' });
      await expect(service.rename(5, 'Beta')).resolves.toMatchObject({ id: 5, name: 'Beta' });
    });

    it('throws NotFound when the project is missing', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      await expect(service.rename(5, 'Beta')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft-deletes the project, releasing any assigned items first', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // items in project
        .mockResolvedValueOnce({ rows: [] }) // log release 1
        .mockResolvedValueOnce({ rows: [] }) // UPDATE items → project_id null
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] }); // UPDATE projects → deleted_at

      const res = await service.remove(5, 9);

      expect(res).toEqual({ deleted: true, released: 1 });
      expect(client.query.mock.calls[3][0]).toContain('deleted_at = now()');
    });

    it('throws NotFound when the project is missing or already deleted', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no items
        .mockResolvedValueOnce({ rows: [] }) // UPDATE items → project_id null
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // UPDATE projects changed nothing

      await expect(service.remove(5, 9)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
