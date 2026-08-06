#!/usr/bin/env node

import { App, Tags } from 'aws-cdk-lib';

import { environmentFor } from '../config/environments.js';
import {
	ApiStack,
	DataStack,
	EventsStack,
	NetworkStack,
	ObservabilityStack,
	WorkersStack,
} from '../lib/stacks.js';

const app = new App();

const config = environmentFor(app.node.tryGetContext('env') ?? process.env['DEPLOY_ENV']);
const env = config.account
	? { account: config.account, region: config.region }
	: { region: config.region };
const common = { config, env };

const prefix = `poc-vpn-${config.name}`;

const network = new NetworkStack(app, `${prefix}-network`, common);
const data = new DataStack(app, `${prefix}-data`, { ...common, network });
const events = new EventsStack(app, `${prefix}-events`, { ...common, network });

new ApiStack(app, `${prefix}-api`, { ...common, data, events });
new WorkersStack(app, `${prefix}-workers`, { ...common, network, data });
new ObservabilityStack(app, `${prefix}-observability`, common);

Tags.of(app).add('project', 'poc-vpn');
Tags.of(app).add('environment', config.name);
Tags.of(app).add('managed-by', 'cdk');
