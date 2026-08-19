// The JWKS key provider is only used when verifying a token's signature at
// runtime; validate() never calls it, so we stub the module to keep the test
// self-contained (and avoid loading jwks-rsa under Jest).
jest.mock('jwks-rsa', () => ({
  passportJwtSecret: () => (_req: unknown, _token: unknown, done: (e: unknown, key: string) => void) =>
    done(null, 'test-key'),
}));

import { UnauthorizedException } from '@nestjs/common';
import { CognitoStrategy } from './cognito.strategy';

describe('CognitoStrategy', () => {
  const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '19hf1ddteog5peadgjvjkt2vn9';
  let users: { resolveUserId: jest.Mock };
  let strategy: CognitoStrategy;

  beforeEach(() => {
    users = { resolveUserId: jest.fn().mockResolvedValue(42) };
    strategy = new CognitoStrategy(users as any);
  });

  // A minimal Cognito access-token payload; override per test.
  const payload = (overrides: Record<string, unknown> = {}) => ({
    sub: 'sub-123',
    token_use: 'access',
    client_id: CLIENT_ID,
    username: 'jdoe',
    email: 'jdoe@vtec.com',
    ...overrides,
  });

  it('rejects a token issued for another application', async () => {
    await expect(strategy.validate(payload({ client_id: 'someone-else' }) as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps the Admin group to the admin role and resolves the local user', async () => {
    const user = await strategy.validate(payload({ 'cognito:groups': ['Admin'] }) as any);
    expect(user).toEqual({ id: 42, email: 'jdoe@vtec.com', role: 'admin' });
    expect(users.resolveUserId).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'sub-123', email: 'jdoe@vtec.com', role: 'admin' }),
    );
  });

  it('gives the strongest role when the user is in several groups', async () => {
    const manager = await strategy.validate(payload({ 'cognito:groups': ['WaferProcessing', 'ProjectManager'] }) as any);
    expect(manager.role).toBe('manager');

    const admin = await strategy.validate(payload({ 'cognito:groups': ['DeviceTesting', 'Admin'] }) as any);
    expect(admin.role).toBe('admin');
  });

  it('defaults to employee when no group maps to a role', async () => {
    const unknown = await strategy.validate(payload({ 'cognito:groups': ['SomethingElse'] }) as any);
    expect(unknown.role).toBe('employee');

    const none = await strategy.validate(payload() as any);
    expect(none.role).toBe('employee');
  });

  it('accepts an id token (aud instead of client_id)', async () => {
    const user = await strategy.validate(
      payload({ client_id: undefined, aud: CLIENT_ID, token_use: 'id', 'cognito:groups': ['DeviceTestingManager'] }) as any,
    );
    expect(user.role).toBe('manager');
  });

  it('falls back to a synthetic email when the token has none', async () => {
    await strategy.validate(payload({ email: undefined, 'cognito:groups': ['Admin'] }) as any);
    expect(users.resolveUserId).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'sub-123@cognito.local' }),
    );
  });
});
