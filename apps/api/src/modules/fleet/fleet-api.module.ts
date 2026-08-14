import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { FleetModule } from '../../shared/fleet/fleet.module.js';
import { moduleLoggerProvider } from '../../shared/http/module-logger.js';
import { RegionsController } from './controllers/regions.controller.js';
import { RegionsService } from './services/regions.service.js';

@Module({
	imports: [AccessControlModule, DatabaseModule, FleetModule],
	controllers: [RegionsController],
	providers: [moduleLoggerProvider('fleet'), RegionsService],
})
export class FleetApiModule {}
