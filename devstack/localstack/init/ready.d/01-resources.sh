#!/bin/bash
#
# Provisions the AWS-shaped resources the adapters expect. Runs after LocalStack
# reports ready, via /etc/localstack/init/ready.d.
#
# Idempotent throughout: re-running `up` on a warm volume must not half-fail.

set -eu

REGION="${AWS_DEFAULT_REGION:-us-east-1}"

awslocal s3api head-bucket --bucket poc-vpn-assets --region "$REGION" 2>/dev/null ||
	awslocal s3 mb s3://poc-vpn-assets --region "$REGION"

# Outbound notifications are the only asynchronous work in this phase. They get
# a dead-letter queue because a dropped verification e-mail is a user stuck at
# the signup wall who has no way to tell us the send failed.
awslocal sqs create-queue --queue-name poc-vpn-notifications-dlq --region "$REGION"
NOTIFICATIONS_DLQ_ARN=$(awslocal sqs get-queue-attributes \
	--queue-url "http://localhost:4566/000000000000/poc-vpn-notifications-dlq" \
	--attribute-names QueueArn --query 'Attributes.QueueArn' --output text --region "$REGION")
awslocal sqs create-queue \
	--queue-name poc-vpn-notifications \
	--attributes "{\"VisibilityTimeout\":\"60\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${NOTIFICATIONS_DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}" \
	--region "$REGION"

awslocal sns create-topic --name poc-vpn-domain-events --region "$REGION"

# One credential per exit node, under the name its exit_nodes row points at.
# The values come from the compose file, which hands the same interpolation to
# the node itself — so what is stored here is what the node was started with,
# and neither can drift from the other.
#
# `set -eu` above is load-bearing: an unset variable fails the seed loudly
# instead of writing an empty secret that 401s much later.
seed_exit_node_credential() {
	awslocal secretsmanager create-secret \
		--name "poc-vpn/exit-node/$1" --secret-string "$2" --region "$REGION" >/dev/null 2>&1 ||
		awslocal secretsmanager put-secret-value \
			--secret-id "poc-vpn/exit-node/$1" --secret-string "$2" --region "$REGION" >/dev/null
}

seed_exit_node_credential sa "$EXIT_NODE_API_TOKEN_SA"
seed_exit_node_credential na "$EXIT_NODE_API_TOKEN_NA"
seed_exit_node_credential eu "$EXIT_NODE_API_TOKEN_EU"
seed_exit_node_credential as "$EXIT_NODE_API_TOKEN_AS"
seed_exit_node_credential af "$EXIT_NODE_API_TOKEN_AF"
