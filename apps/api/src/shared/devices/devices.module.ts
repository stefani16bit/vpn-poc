import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { DeviceProvisioner } from './device-provisioner.service.js';
import { DeviceRepository } from './device.repository.js';
import { ExitNodeDirectory } from './exit-node-directory.service.js';

@Module({
	imports: [DatabaseModule],
	providers: [DeviceRepository, DeviceProvisioner, ExitNodeDirectory],
	exports: [DeviceRepository, DeviceProvisioner, ExitNodeDirectory],
})
export class DevicesModule {}
