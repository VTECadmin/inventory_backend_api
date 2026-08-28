import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { UsersService } from '../users/users.service';

type Role = 'admin' | 'manager' | 'employee';

// Maps a Cognito group to an application role. Only Admin and InventoryManager
// carry an elevated role; every other group (or none) defaults to employee. A
// user in several groups receives the strongest role (admin > manager > employee).
const GROUP_ROLE: Record<string, Role> = {
  Admin: 'admin',
  InventoryManager: 'manager',
};

const REGION = process.env.COGNITO_REGION ?? 'eu-central-1';
const POOL_ID = process.env.COGNITO_USER_POOL_ID ?? 'eu-central-1_fhjuxln2B';
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '21vatrg53ktubcmaklpaust2e8';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;

interface CognitoPayload {
  sub: string;
  token_use: 'access' | 'id';
  client_id?: string; // present on access tokens
  aud?: string; // present on id tokens
  username?: string;
  'cognito:username'?: string;
  'cognito:groups'?: string[];
  email?: string;
  name?: string;
}

/**
 * Validates a Cognito-issued JWT (access or id token): the signature is checked
 * against the pool's public keys (JWKS), the issuer and app client must match,
 * and the user's Cognito groups are mapped to an application role. The Cognito
 * identity is resolved to a local user row so the rest of the app keeps working
 * with a numeric user id.
 */
@Injectable()
export class CognitoStrategy extends PassportStrategy(Strategy, 'cognito') {
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: ISSUER,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${ISSUER}/.well-known/jwks.json`,
      }),
    });
  }

  async validate(payload: CognitoPayload) {
    // The token must have been issued for this application's client.
    const audience = payload.client_id ?? payload.aud;
    if (audience !== CLIENT_ID) {
      throw new UnauthorizedException('Token was not issued for this application');
    }

    const role = this.roleFromGroups(payload['cognito:groups'] ?? []);
    const email = payload.email ?? `${payload.sub}@cognito.local`;
    const fullName =
      payload.name ?? payload['cognito:username'] ?? payload.username ?? email;

    const id = await this.users.resolveUserId({ sub: payload.sub, email, fullName, role });
    return { id, email, role };
  }

  /** Strongest role among the user's groups; employee when none map. */
  private roleFromGroups(groups: string[]): Role {
    const roles = groups.map((g) => GROUP_ROLE[g]).filter(Boolean) as Role[];
    if (roles.includes('admin')) return 'admin';
    if (roles.includes('manager')) return 'manager';
    return 'employee';
  }
}
