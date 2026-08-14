import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { FleetRepository } from './fleet.repository.js';
import { NodeHealth } from './node-health.service.js';

@Module({
	imports: [DatabaseModule],
	providers: [FleetRepository, NodeHealth],
	exports: [FleetRepository, NodeHealth],
})
export class FleetModule {}
