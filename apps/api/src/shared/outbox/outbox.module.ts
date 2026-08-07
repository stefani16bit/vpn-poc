import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxRepository } from './outbox.repository.js';

@Module({
	imports: [DatabaseModule],
	providers: [OutboxRepository, OutboxRelay],
	exports: [OutboxRepository, OutboxRelay, DatabaseModule],
})
export class OutboxModule {}
