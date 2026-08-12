import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { moduleLoggerProvider } from '../../shared/http/module-logger.js';
import { IdentityModule } from '../../shared/identity/identity.module.js';
import { PermissionsController } from './controllers/permissions.controller.js';
import { PermissionsAdminService } from './services/permissions-admin.service.js';

@Module({
	imports: [AccessControlModule, DatabaseModule, IdentityModule],
	controllers: [PermissionsController],
	providers: [moduleLoggerProvider('permissions'), PermissionsAdminService],
})
export class PermissionsApiModule {}
