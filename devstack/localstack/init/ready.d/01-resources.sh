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
