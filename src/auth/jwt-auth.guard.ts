import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Which Passport strategies may authenticate a request.
//
// Cognito is the real, production authentication — login itself is handled by
// the company dashboard (Cognito), and this backend only *validates* the token.
// The local email+password JWT strategy is dev/test-only scaffolding: it is
// DISABLED by default and only enabled when ALLOW_LOCAL_LOGIN=1. Keeping it off
// in production removes the shared-secret token-forgery surface entirely (a
// forged local JWT can no longer authenticate).
const STRATEGIES = process.env.ALLOW_LOCAL_LOGIN === '1' ? ['cognito', 'jwt'] : ['cognito'];

@Injectable()
export class JwtAuthGuard extends AuthGuard(STRATEGIES) {}
