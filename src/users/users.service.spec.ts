import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { CognitoDirectoryService } from './cognito-directory.service';

describe('UsersService.resolveUserId', () => {
  let service: UsersService;
  let db: { query: jest.Mock; queryOne: jest.Mock };

  beforeEach(async () => {
    db = { query: jest.fn(), queryOne: jest.fn() };
    const cognito = { listPoolUsers: jest.fn().mockResolvedValue(null) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DatabaseService, useValue: db },
        { provide: CognitoDirectoryService, useValue: cognito },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  const params = { sub: 'sub-1', email: 'a@vtec.com', fullName: 'Alice', role: 'admin' as const };

  it('returns the existing id when matched by cognito_sub (no write)', async () => {
    db.queryOne.mockResolvedValueOnce({ id: 7 }); // found by cognito_sub
    await expect(service.resolveUserId(params)).resolves.toBe(7);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('links an existing row matched by email and returns its id', async () => {
    db.queryOne
      .mockResolvedValueOnce(null) // not found by sub
      .mockResolvedValueOnce({ id: 9 }); // found by email
    db.query.mockResolvedValueOnce(undefined); // UPDATE cognito_sub

    await expect(service.resolveUserId(params)).resolves.toBe(9);
    expect(String(db.query.mock.calls[0][0])).toContain('UPDATE users SET cognito_sub');
  });

  it('provisions a new user when none exists', async () => {
    db.queryOne
      .mockResolvedValueOnce(null) // not by sub
      .mockResolvedValueOnce(null) // not by email
      .mockResolvedValueOnce({ id: 15 }); // INSERT ... RETURNING id

    await expect(service.resolveUserId(params)).resolves.toBe(15);
    expect(String(db.queryOne.mock.calls[2][0])).toContain('INSERT INTO users');
  });
});
