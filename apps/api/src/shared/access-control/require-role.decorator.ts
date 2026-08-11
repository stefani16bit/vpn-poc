import { SetMetadata } from '@nestjs/common';

import type { UserRole } from '../identity/user.js';

export const REQUIRED_ROLE = 'REQUIRED_ROLE';

export const RequiresRole = (role: UserRole): MethodDecorator => SetMetadata(REQUIRED_ROLE, role);
