import { Module } from '@nestjs/common';

import { VerificationTokenRepository } from './verification-token.repository.js';
import { VerificationTokenService } from './verification-token.service.js';

@Module({
	providers: [VerificationTokenService, VerificationTokenRepository],
	exports: [VerificationTokenService],
})
export class VerificationModule {}
