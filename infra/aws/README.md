# climate-project-api — AWS deployment

This directory holds the CloudFormation templates that stand up `climate-project-api` in AWS. This README is the runbook for deploying it — read it before touching production.

## Architecture overview

Deployment is split into two CloudFormation stacks. `climate-project-api-bootstrap.yml` provisions the long-lived, rarely-changed foundation: an ECR repository for API images, the `AppRunnerEcrAccessRole` App Runner uses to pull those images, and the `GitHubDeployRole` that GitHub Actions assumes via OIDC to run deploys. `climate-project-api-prod-service.yml` provisions the App Runner service itself and is deployed on every release, taking the image URI and the ECR access role ARN (both read from the bootstrap stack's outputs) as parameters. In steady state: bootstrap stack once (or whenever the deploy role's permissions change), service stack on every deploy.

## Automated path (preferred)

```
gh workflow run deploy-prod.yml --repo TIMSInternational/organizational-climate-platform --ref main
```

This runs `.github/workflows/deploy-prod.yml`, which tests the API, builds and pushes the image to ECR, deploys the service stack, and health-checks the result.

**Status as of 2026-08-03.** The account-wide GitHub Actions billing block described in earlier
revisions of this file is **resolved** — workflows execute again. `CI` now runs on every PR and
every push to `main`, and its .NET job passes. Two things are still unverified, so do not yet
treat the automated deploy as proven:

- **`deploy-prod.yml` has never had a successful run.** It is `workflow_dispatch`-only and was
  never dispatched while billing was blocked. Every production deploy to date went through the
  manual path below.
- **The OIDC trust relationship has not been confirmed against the live account.** The
  `GitHubRepository` parameter default in `climate-project-api-bootstrap.yml` was updated to
  `TIMSInternational/organizational-climate-platform` after the repo rename, but a
  CloudFormation parameter **default only applies when the parameter is not supplied** — the
  deployed stack retains the value it was last deployed with, which predates the rename. If the
  live `climate-project-github-deploy-prod` role still trusts
  `repo:TIMSInternational/climate-project-api:*`, the first dispatched deploy fails at
  `configure-aws-credentials` with a `sts:AssumeRoleWithWebIdentity` denial. Verify before
  dispatching:

  ```
  aws iam get-role --role-name climate-project-github-deploy-prod \
    --query 'Role.AssumeRolePolicyDocument.Statement[].Condition' --output json
  ```

  Both `sub` entries must name `organizational-climate-platform`. If they name the old repo,
  redeploy the bootstrap stack with `GitHubRepository` passed explicitly:

  ```
  aws cloudformation deploy \
    --stack-name climate-project-api-bootstrap \
    --template-file infra/aws/climate-project-api-bootstrap.yml \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides GitHubRepository=TIMSInternational/organizational-climate-platform
  ```

  This check requires credentials for the production account (`AWS_ACCOUNT_ID` repo variable,
  `747814092517`). Note that the resource names in the table below are **live infrastructure
  identifiers** and still use the pre-rename `climate-project-api` prefix deliberately —
  renaming them orphans the deployed stacks. Only the GitHub repository reference changed.

Tracking issue: https://github.com/TIMSInternational/organizational-climate-platform/issues/68

## Manual path (what actually deployed the currently-live service)

Used as a workaround while GitHub Actions is billing-blocked. Requires local AWS CLI access with permissions to read the bootstrap stack, push to ECR, and deploy the service stack (or the `climate-project-github-deploy-prod` role, if assumable locally).

1. **Read bootstrap outputs** (ECR repository URI and the App Runner ECR access role ARN):

   ```
   aws cloudformation describe-stacks \
     --stack-name climate-project-api-bootstrap \
     --region us-east-1
   ```

   Take `EcrRepositoryUri` and `AppRunnerEcrAccessRoleArn` from `Stacks[0].Outputs`.

2. **Authenticate Docker to ECR**:

   ```
   aws ecr get-login-password --region us-east-1 \
     | docker login --username AWS --password-stdin <ecr-registry>
   ```

3. **Build the image.**

   > **Apple Silicon / ARM hosts: `--platform linux/amd64` is REQUIRED.** Docker on Apple Silicon builds `linux/arm64` images by default. App Runner only runs `linux/amd64`. An image built without this flag pushes and deploys "successfully" but the App Runner service then fails to start (or crash-loops) — this cost two 19-minute failed deploys during initial rollout before the cause was identified. Always pass the flag explicitly, even on machines that are currently x86, so the command is portable:

   ```
   docker build --platform linux/amd64 -t <ecr-uri>:<tag> .
   ```

4. **Push to ECR**:

   ```
   docker push <ecr-uri>:<tag>
   ```

5. **Deploy the service stack**:

   ```
   aws cloudformation deploy \
     --stack-name climate-project-api-prod \
     --template-file infra/aws/climate-project-api-prod-service.yml \
     --capabilities CAPABILITY_NAMED_IAM \
     --no-fail-on-empty-changeset \
     --parameter-overrides \
       ServiceName=climate-project-api-prod \
       ImageIdentifier=<ecr-uri>:<tag> \
       EcrAccessRoleArn=<AppRunnerEcrAccessRoleArn from step 1>
   ```

   > `CorsAllowedOrigin`, `CorsAllowedWildcardOrigin`, `TrackingJwtSecretArn`,
   > `DatabaseConnectionStringSecretArn` and `InternalApiKeySecretArn` have no CloudFormation
   > default and aren't in the command above — `aws cloudformation deploy` reuses each
   > parameter's previous value on a stack **update** when it's omitted, so this is safe once
   > every one of them has already been supplied at least once. On the **first** deploy after
   > a new no-default parameter is introduced (like `InternalApiKeySecretArn`, added for the
   > `/api/internal/*` routes), it must be passed explicitly that one time or the deploy fails
   > with a missing-parameter error — and until it's set, every `/api/internal/*` request
   > 500s in production with `"Internal API is not configured."` (`InternalApiKeyFilter`
   > fails closed when the key is unset). Create an `InternalApiKey` secret in Secrets
   > Manager first (same shared value climate-tracking's `INTERNAL_API_KEY` config points
   > at), then add `InternalApiKeySecretArn=<that-secret-arn>` to the command above for that
   > first run.

6. Confirm the service is healthy by checking the `ServiceUrl` stack output and hitting `/health`.

## Stack and resource name reference

| Resource | Name |
|---|---|
| Bootstrap stack | `climate-project-api-bootstrap` |
| Service stack | `climate-project-api-prod` |
| App Runner ECR access role | `climate-project-apprunner-ecr-access-prod` |
| GitHub OIDC deploy role | `climate-project-github-deploy-prod` |
| Live production URL | https://bhgrdkd4gt.us-east-1.awsapprunner.com |
