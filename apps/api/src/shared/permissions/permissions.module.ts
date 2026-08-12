import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { PermissionRepository } from './repositories/permission.repository.js';
import { PermissionService } from './permission.service.js';

@Module({
	imports: [DatabaseModule],
	providers: [PermissionRepository, PermissionService],
	exports: [PermissionRepository, PermissionService],
})
export class PermissionsModule {}
