import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { EnvironmentConfig } from '../config/environments.js';

export interface PocVpnStackProps extends StackProps {
	readonly config: EnvironmentConfig;
}

abstract class PocVpnStack extends Stack {
	protected readonly config: EnvironmentConfig;

	constructor(scope: Construct, id: string, props: PocVpnStackProps) {
		super(scope, id, props);
		this.config = props.config;
	}
}

export class NetworkStack extends PocVpnStack {}

export class DataStack extends PocVpnStack {
	constructor(scope: Construct, id: string, props: PocVpnStackProps & { network: NetworkStack }) {
		super(scope, id, props);
		this.addStackDependency(props.network);
	}
}

export class EventsStack extends PocVpnStack {
	constructor(scope: Construct, id: string, props: PocVpnStackProps & { network: NetworkStack }) {
		super(scope, id, props);
		this.addStackDependency(props.network);
	}
}

export class ApiStack extends PocVpnStack {
	constructor(
		scope: Construct,
		id: string,
		props: PocVpnStackProps & { data: DataStack; events: EventsStack },
	) {
		super(scope, id, props);
		this.addStackDependency(props.data);
		this.addStackDependency(props.events);
	}
}

export class WorkersStack extends PocVpnStack {
	constructor(
		scope: Construct,
		id: string,
		props: PocVpnStackProps & { network: NetworkStack; data: DataStack },
	) {
		super(scope, id, props);
		this.addStackDependency(props.network);
		this.addStackDependency(props.data);
	}
}

export class ObservabilityStack extends PocVpnStack {}
