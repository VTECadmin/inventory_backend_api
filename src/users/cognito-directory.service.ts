import { Injectable, Logger } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';

const REGION = process.env.COGNITO_REGION ?? 'eu-central-1';
const POOL_ID = process.env.COGNITO_USER_POOL_ID ?? 'eu-central-1_fhjuxln2B';

// Cognito groups that map to elevated inventory roles (mirrors cognito.strategy).
const ADMIN_GROUP = 'Admin';
const MANAGER_GROUP = 'InventoryManager';

export interface PoolUser {
  sub: string;
  username: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'employee';
}

/**
 * Lists every user of the Cognito user pool (the same population the dashboard's
 * Team page shows) together with their inventory role, derived from group
 * membership. Requires cognito-idp:ListUsers / ListUsersInGroup on the pool via
 * the EC2 instance role. When those calls fail (no IAM, no credentials, offline)
 * it returns null so callers can fall back to the local users table.
 */
@Injectable()
export class CognitoDirectoryService {
  private readonly logger = new Logger(CognitoDirectoryService.name);

  async listPoolUsers(): Promise<PoolUser[] | null> {
    if (!POOL_ID) return null;
    const client = new CognitoIdentityProviderClient({ region: REGION });
    try {
      const users = await this.listAllUsers(client);
      const admins = await this.groupMembers(client, ADMIN_GROUP);
      const managers = await this.groupMembers(client, MANAGER_GROUP);

      for (const u of users) {
        if (admins.has(u.sub) || admins.has(u.username)) u.role = 'admin';
        else if (managers.has(u.sub) || managers.has(u.username)) u.role = 'manager';
      }
      return users;
    } catch (err: any) {
      this.logger.warn(
        `Cognito directory unavailable (${err?.name ?? 'error'}: ${err?.message ?? err}); ` +
          'falling back to the local users table.',
      );
      return null;
    }
  }

  private async listAllUsers(client: CognitoIdentityProviderClient): Promise<PoolUser[]> {
    const out: PoolUser[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListUsersCommand({ UserPoolId: POOL_ID, Limit: 60, PaginationToken: token }),
      );
      for (const u of res.Users ?? []) out.push(this.toPoolUser(u));
      token = res.PaginationToken;
    } while (token);
    return out;
  }

  /** Subs (and usernames) of the members of one group; empty if the group is absent. */
  private async groupMembers(
    client: CognitoIdentityProviderClient,
    group: string,
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    let token: string | undefined;
    try {
      do {
        const res = await client.send(
          new ListUsersInGroupCommand({ UserPoolId: POOL_ID, GroupName: group, NextToken: token }),
        );
        for (const u of res.Users ?? []) {
          const { sub, username } = this.toPoolUser(u);
          if (sub) ids.add(sub);
          if (username) ids.add(username);
        }
        token = res.NextToken;
      } while (token);
    } catch (err: any) {
      // A missing group is not fatal — those users simply stay 'employee'.
      this.logger.warn(`Could not read Cognito group "${group}": ${err?.message ?? err}`);
    }
    return ids;
  }

  private toPoolUser(u: UserType): PoolUser {
    const attrs = Object.fromEntries((u.Attributes ?? []).map((a) => [a.Name, a.Value ?? '']));
    const name =
      attrs.name ||
      [attrs.given_name, attrs.family_name].filter(Boolean).join(' ') ||
      attrs.email ||
      u.Username ||
      '';
    return {
      sub: attrs.sub ?? u.Username ?? '',
      username: u.Username ?? '',
      email: attrs.email ?? '',
      name,
      role: 'employee',
    };
  }
}
