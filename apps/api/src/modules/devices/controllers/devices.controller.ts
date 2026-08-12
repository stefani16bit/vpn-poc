import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import {
	createDeviceRequestSchema,
	type CreateDeviceRequest,
	type CreateDeviceResponse,
	type DeviceListResponse,
} from '@vpn/contracts';

import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { CapabilityGuard } from '../../../shared/access-control/capability.guard.js';
import { Auth } from '../../../shared/access-control/current-auth.decorator.js';
import { PermissionGuard } from '../../../shared/access-control/permission.guard.js';
import { RequiresCapability } from '../../../shared/access-control/require-capability.decorator.js';
import { RequiresPermission } from '../../../shared/access-control/require-permission.decorator.js';
import { ZodBody } from '../../../shared/validation/zod-body.pipe.js';
import { DevicesService } from '../services/devices.service.js';

@Controller('devices')
@UseGuards(AccessTokenGuard, CapabilityGuard, PermissionGuard)
export class DevicesController {
	constructor(private readonly devices: DevicesService) {}

	@Get()
	@RequiresCapability('vpn_access')
	async list(@Auth() claims: AccessTokenClaims): Promise<DeviceListResponse> {
		return this.devices.list(claims);
	}

	@Post()
	@HttpCode(201)
	@RequiresCapability('vpn_access')
	@RequiresPermission('devices.create')
	async create(
		@Auth() claims: AccessTokenClaims,
		@Body(new ZodBody(createDeviceRequestSchema)) body: CreateDeviceRequest,
	): Promise<CreateDeviceResponse> {
		return this.devices.create(claims.accountId, claims.userId, body);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequiresCapability('vpn_access')
	async revoke(@Auth() claims: AccessTokenClaims, @Param('id') id: string): Promise<void> {
		await this.devices.revoke(claims, id);
	}
}
