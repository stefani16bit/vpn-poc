import { CreateQueueCommand, DeleteQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import { afterAll } from 'vitest';

import { describeJobQueueContract } from '@vpn/testing/contracts';

import { INTEGRATION } from '../integration.env.js';
import { SqsJobQueue } from './SqsJobQueue.js';

const VISIBILITY_SECONDS = 3;

const client = new SQSClient({
	region: INTEGRATION.awsRegion,
	endpoint: INTEGRATION.sqsEndpoint,
});

const created: string[] = [];

afterAll(async () => {
	for (const queueUrl of created) {
		await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
	}
	client.destroy();
});

describeJobQueueContract('SqsJobQueue', async () => {
	const response = await client.send(
		new CreateQueueCommand({
			QueueName: `it-queue-${Date.now()}-${created.length}`,
			Attributes: { VisibilityTimeout: String(VISIBILITY_SECONDS) },
		}),
	);

	const queueUrl = response.QueueUrl ?? '';
	created.push(queueUrl);

	return {
		queue: new SqsJobQueue({
			queueUrl,
			region: INTEGRATION.awsRegion,
			endpoint: INTEGRATION.sqsEndpoint,
		}),
		expire: () =>
			new Promise<void>((resolve) => {
				setTimeout(resolve, (VISIBILITY_SECONDS + 1) * 1000);
			}),
	};
});
