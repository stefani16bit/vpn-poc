import { SetMetadata } from '@nestjs/common';

import type { Permission } from '@vpn/contracts';

export const REQUIRED_PERMISSION = 'REQUIRED_PERMISSION';

export const RequiresPermission = (permission: Permission): MethodDecorator =>
	SetMetadata(REQUIRED_PERMISSION, permission);
