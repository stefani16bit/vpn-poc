import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_TRANSACTION = 'skipTenantTransaction';

// For a handler that talks to a third party. The interceptor would otherwise
// hold a pool connection open across the round trip, and the connection is the
// scarce thing — not the transaction.
//
// It does not exempt the handler from the policy: whatever it reads still runs
// inside `runInAccount`, opened narrowly by the service itself.
export const SkipTenantTransaction = (): MethodDecorator =>
	SetMetadata(SKIP_TENANT_TRANSACTION, true);
