import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { DevicesModule as DeviceKernelModule } from '../../shared/devices/devices.module.js';
import { FleetModule } from '../../shared/fleet/fleet.module.js';
import { moduleLoggerProvider } from '../../shared/http/module-logger.js';
import { IdentityModule } from '../../shared/identity/identity.module.js';
import { OutboxModule } from '../../shared/outbox/outbox.module.js';
import { DevicesController } from './controllers/devices.controller.js';
import { DevicesService } from './services/devices.service.js';

@Module({
	imports: [
		AccessControlModule,
		DatabaseModule,
		DeviceKernelModule,
		FleetModule,
		IdentityModule,
		OutboxModule,
	],
	controllers: [DevicesController],
	providers: [moduleLoggerProvider('devices'), DevicesService],
})
export class DevicesApiModule {}
