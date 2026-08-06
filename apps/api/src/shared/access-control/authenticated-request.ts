import type { Request } from 'express';

import type { AccessTokenClaims } from './access-token.service.js';

export interface AuthenticatedRequest extends Request {
	auth?: AccessTokenClaims;
}
