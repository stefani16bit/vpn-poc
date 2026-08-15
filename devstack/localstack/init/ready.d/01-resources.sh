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

# A write is a rotation: Secrets Manager moves AWSCURRENT to the new version and
# AWSPREVIOUS to the one it displaced, and the version before that keeps no label
# at all. So calling this twice for one name leaves both halves of a window, and
# calling it a third time retires the first value.
#
# `set -eu` above is load-bearing: an unset variable fails the seed loudly
# instead of writing an empty secret that 401s much later.
seed_secret() {
	awslocal secretsmanager create-secret \
		--name "$1" --secret-string "$2" --region "$REGION" >/dev/null 2>&1 ||
		awslocal secretsmanager put-secret-value \
			--secret-id "$1" --secret-string "$2" --region "$REGION" >/dev/null
}

# One credential per exit node, under the name its exit_nodes row points at.
# The values come from the compose file, which hands the same interpolation to
# the node itself — so what is stored here is what the node was started with,
# and neither can drift from the other.
seed_secret poc-vpn/exit-node/sa "$EXIT_NODE_API_TOKEN_SA"
seed_secret poc-vpn/exit-node/na "$EXIT_NODE_API_TOKEN_NA"
seed_secret poc-vpn/exit-node/eu "$EXIT_NODE_API_TOKEN_EU"
seed_secret poc-vpn/exit-node/as "$EXIT_NODE_API_TOKEN_AS"
seed_secret poc-vpn/exit-node/af "$EXIT_NODE_API_TOKEN_AF"

# The signing secret, seeded twice with the retired value first, so the devstack
# permanently carries an open rotation window. A window somebody has to arrange
# before it can be checked is a window nothing checks; this way check.sh asserts
# it every run, and a token signed before a rotation is a state that exists here
# rather than a paragraph in a decision log.
#
# Re-running converges: the second write puts CURRENT back on top of PREVIOUS.
seed_secret poc-vpn/auth/jwt-secret "$AUTH_JWT_SECRET_PREVIOUS"
seed_secret poc-vpn/auth/jwt-secret "$AUTH_JWT_SECRET_CURRENT"

# Seeded even though BILLING_DRIVER is memory here (DEC-009): what the assertion
# proves is that the ref resolves, which is the chain that breaks in a deploy.
seed_secret poc-vpn/billing/stripe-webhook-secret "$STRIPE_WEBHOOK_SECRET_FIXTURE"
