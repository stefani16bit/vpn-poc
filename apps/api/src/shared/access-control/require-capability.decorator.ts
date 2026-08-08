import { SetMetadata } from '@nestjs/common';

import type { Capability } from '@vpn/contracts';

export const REQUIRED_CAPABILITY = 'REQUIRED_CAPABILITY';

export const RequiresCapability = (capability: Capability): MethodDecorator =>
	SetMetadata(REQUIRED_CAPABILITY, capability);
