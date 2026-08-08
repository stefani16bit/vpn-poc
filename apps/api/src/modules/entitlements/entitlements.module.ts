import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { EntitlementsController } from './controllers/entitlements.controller.js';

@Module({
	imports: [AccessControlModule],
	controllers: [EntitlementsController],
})
export class EntitlementsApiModule {}
