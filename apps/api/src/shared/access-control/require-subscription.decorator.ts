import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const REQUIRED_SUBSCRIPTION = 'REQUIRED_SUBSCRIPTION';

export const RequiresSubscription = (): CustomDecorator<string> =>
	SetMetadata(REQUIRED_SUBSCRIPTION, true);
