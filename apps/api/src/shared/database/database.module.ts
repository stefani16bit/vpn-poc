import { Module } from '@nestjs/common';

import { TransactionRunner } from './transaction-runner.js';

@Module({
	providers: [TransactionRunner],
	exports: [TransactionRunner],
})
export class DatabaseModule {}
