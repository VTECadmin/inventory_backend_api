// Mock the AWS SDK so no real Cognito call is made. The factory can only touch
// variables whose name starts with "mock" (jest hoists jest.mock above imports).
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockSend })),
  ListUsersCommand: jest.fn((input) => ({ kind: 'list', input })),
  ListUsersInGroupCommand: jest.fn((input) => ({ kind: 'group', input })),
}));

import { CognitoDirectoryService } from './cognito-directory.service';

describe('CognitoDirectoryService', () => {
  let service: CognitoDirectoryService;

  beforeEach(() => {
    mockSend.mockReset();
    service = new CognitoDirectoryService(); // fresh instance → empty cache
  });

  it('caches the pool so ListUsers is not called on every request', async () => {
    mockSend.mockResolvedValue({
      Users: [
        {
          Username: 'u1',
          Attributes: [
            { Name: 'sub', Value: 's1' },
            { Name: 'email', Value: 'alice@vtec.com' },
            { Name: 'name', Value: 'Alice' },
          ],
        },
      ],
    });

    const first = await service.listPoolUsers();
    const second = await service.listPoolUsers();

    // One fetch = ListUsers + the two group lookups (3 sends), reused afterwards.
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(second).toBe(first); // same cached array reference
    expect(first).toEqual([expect.objectContaining({ sub: 's1', name: 'Alice' })]);
  });

  it('returns null when Cognito is unavailable (degraded mode)', async () => {
    mockSend.mockRejectedValue(new Error('AccessDeniedException'));
    await expect(service.listPoolUsers()).resolves.toBeNull();
  });
});
