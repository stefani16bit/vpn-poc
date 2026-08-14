import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { DeviceProvisioner } from './device-provisioner.service.js';
import { DeviceRepository } from './device.repository.js';
import { PeerReconciler } from './peer-reconciler.service.js';

@Module({
	imports: [DatabaseModule, FleetModule],
	providers: [DeviceRepository, DeviceProvisioner, PeerReconciler],
	exports: [DeviceRepository, DeviceProvisioner, PeerReconciler],
})
export class DevicesModule {}
