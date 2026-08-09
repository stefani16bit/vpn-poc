import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OutboxConsumer } from './outbox-consumer.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxRepository } from './outbox.repository.js';

@Module({
	imports: [DatabaseModule, DevicesModule, NotificationsModule],
	providers: [OutboxRepository, OutboxRelay, OutboxConsumer],
	exports: [OutboxRepository, OutboxRelay, OutboxConsumer, DatabaseModule],
})
export class OutboxModule {}
