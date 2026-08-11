import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { IdentityService } from './identity.service.js';
import { AccountRepository } from './repositories/account.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { SessionRepository } from './repositories/session.repository.js';

@Module({
	imports: [DatabaseModule],
	providers: [IdentityService, AccountRepository, UserRepository, SessionRepository],
	exports: [IdentityService, AccountRepository, UserRepository, SessionRepository],
})
export class IdentityModule {}
