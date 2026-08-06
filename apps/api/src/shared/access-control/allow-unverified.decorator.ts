import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED = 'ALLOW_UNVERIFIED';

export const AllowUnverified = (): MethodDecorator => SetMetadata(ALLOW_UNVERIFIED, true);
