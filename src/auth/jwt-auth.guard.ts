import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Accepts a Cognito token first (production), falling back to the local JWT
// (used by the /auth/login path for development and tests).
@Injectable()
export class JwtAuthGuard extends AuthGuard(['cognito', 'jwt']) {}
