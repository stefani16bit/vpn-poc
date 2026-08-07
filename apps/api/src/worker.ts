export { AppModule } from './app.module.js';

export { OutboxRepository } from './shared/outbox/outbox.repository.js';
export type { PendingEntry } from './shared/outbox/outbox.repository.js';
export { parseOutboxMessage } from './shared/outbox/outbox-message.js';
export type { OutboxMessage, OutboxKind } from './shared/outbox/outbox-message.js';
export { TransactionRunner } from './shared/database/transaction-runner.js';
export type { Executor } from './shared/database/transaction-runner.js';

export { NotificationDispatcher } from './shared/notifications/notification-dispatcher.js';
export { NotificationConsumer } from './shared/notifications/notification-consumer.js';
export type { ConsumerReport } from './shared/notifications/notification-consumer.js';
export { OutboxRelay } from './shared/outbox/outbox-relay.js';
