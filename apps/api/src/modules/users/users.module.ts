import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { moduleLoggerProvider } from '../../shared/http/module-logger.js';
import { IdentityModule } from '../../shared/identity/identity.module.js';
import { UsersController } from './controllers/users.controller.js';
import { UsersService } from './services/users.service.js';

@Module({
	imports: [AccessControlModule, DatabaseModule, IdentityModule],
	controllers: [UsersController],
	providers: [moduleLoggerProvider('users'), UsersService],
})
export class UsersApiModule {}
