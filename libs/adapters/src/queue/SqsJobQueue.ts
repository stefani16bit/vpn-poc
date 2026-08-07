import {
	DeleteMessageCommand,
	ReceiptHandleIsInvalid,
	ReceiveMessageCommand,
	SendMessageCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';

import type { IJobQueue, JobEnvelope, ReceiveOptions, ReceivedJob } from '@vpn/ports';

export interface SqsJobQueueOptions {
	readonly queueUrl: string;
	readonly region: string;
	readonly endpoint?: string | undefined;
}

const DEFAULT_MAX = 10;
const SQS_MAX_PER_RECEIVE = 10;

export class SqsJobQueue implements IJobQueue {
	readonly #client: SQSClient;
	readonly #queueUrl: string;

	constructor(options: SqsJobQueueOptions) {
		this.#client = new SQSClient({
			region: options.region,
			...(options.endpoint ? { endpoint: options.endpoint } : {}),
		});
		this.#queueUrl = options.queueUrl;
	}

	async enqueue(job: JobEnvelope): Promise<void> {
		await this.#client.send(
			new SendMessageCommand({
				QueueUrl: this.#queueUrl,
				MessageBody: JSON.stringify(job),
			}),
		);
	}

	async receive(options: ReceiveOptions = {}): Promise<readonly ReceivedJob[]> {
		const response = await this.#client.send(
			new ReceiveMessageCommand({
				QueueUrl: this.#queueUrl,
				MaxNumberOfMessages: Math.min(options.max ?? DEFAULT_MAX, SQS_MAX_PER_RECEIVE),
				WaitTimeSeconds: options.waitSeconds ?? 0,
			}),
		);

		return (response.Messages ?? []).flatMap((message) => {
			if (!message.MessageId || !message.ReceiptHandle || !message.Body) return [];

			return [
				{
					...(JSON.parse(message.Body) as JobEnvelope),
					id: message.MessageId,
					receipt: message.ReceiptHandle,
				},
			];
		});
	}

	async acknowledge(receipt: string): Promise<void> {
		try {
			await this.#client.send(
				new DeleteMessageCommand({ QueueUrl: this.#queueUrl, ReceiptHandle: receipt }),
			);
		} catch (error) {
			if (error instanceof ReceiptHandleIsInvalid) return;
			if (error instanceof Error && error.name === 'InvalidParameterValue') return;
			throw error;
		}
	}
}
