export { AppModule } from './app.module.js';

export { OutboxRepository } from './shared/outbox/outbox.repository.js';
export type { PendingEntry } from './shared/outbox/outbox.repository.js';
export { parseOutboxJob } from './shared/outbox/outbox-message.js';
export type { OutboxJob, OutboxMessage, OutboxKind } from './shared/outbox/outbox-message.js';
export { TransactionRunner } from './shared/database/transaction-runner.js';
export type { Executor } from './shared/database/transaction-runner.js';

export { NotificationDispatcher } from './shared/notifications/notification-dispatcher.js';
export { OutboxConsumer } from './shared/outbox/outbox-consumer.js';
export type { ConsumerReport } from './shared/outbox/outbox-consumer.js';
export { OutboxRelay } from './shared/outbox/outbox-relay.js';
export { PeerReconciler } from './shared/devices/peer-reconciler.service.js';
export type { ReconcileReport } from './shared/devices/peer-reconciler.service.js';
export { NodeHealth } from './shared/fleet/node-health.service.js';
export type { HealthReport } from './shared/fleet/node-health.service.js';

export { RetentionSweeper } from './shared/maintenance/retention.service.js';
export type { PurgeCounts } from './shared/maintenance/retention.repository.js';
export { SubscriptionReconciler } from './shared/subscriptions/subscription-reconciler.service.js';
export type { SubscriptionReconcileReport } from './shared/subscriptions/subscription-reconciler.service.js';
