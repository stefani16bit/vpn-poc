import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { RetentionRepository } from './retention.repository.js';
import { RetentionSweeper } from './retention.service.js';

@Module({
	imports: [DatabaseModule],
	providers: [RetentionRepository, RetentionSweeper],
	exports: [RetentionSweeper],
})
export class MaintenanceModule {}
