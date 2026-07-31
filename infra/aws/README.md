# climate-project-api — AWS deployment

This directory holds the CloudFormation templates that stand up `climate-project-api` in AWS. This README is the runbook for deploying it — read it before touching production.

## Architecture overview

Deployment is split into two CloudFormation stacks. `climate-project-api-bootstrap.yml` provisions the long-lived, rarely-changed foundation: an ECR repository for API images, the `AppRunnerEcrAccessRole` App Runner uses to pull those images, and the `GitHubDeployRole` that GitHub Actions assumes via OIDC to run deploys. `climate-project-api-prod-service.yml` provisions the App Runner service itself and is deployed on every release, taking the image URI and the ECR access role ARN (both read from the bootstrap stack's outputs) as parameters. In steady state: bootstrap stack once (or whenever the deploy role's permissions change), service stack on every deploy.

## Automated path (preferred)

```
gh workflow run deploy-prod.yml --repo TIMSInternational/climate-project-api --ref main
```

This runs `.github/workflows/deploy-prod.yml`, which tests the API, builds and pushes the image to ECR, deploys the service stack, and health-checks the result.

**Caveat as of this writing:** TIMSInternational's GitHub Actions is billing-blocked account-wide, so no workflow run — including this one — currently executes. Every run fails within seconds on a billing error, not on any test/build content. See the tracking issue for status before assuming this path works: https://github.com/TIMSInternational/climate-project-api/issues/5 ("GitHub Actions billing block prevents all CI/CD runs").

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

6. Confirm the service is healthy by checking the `ServiceUrl` stack output and hitting `/health`.

## Stack and resource name reference

| Resource | Name |
|---|---|
| Bootstrap stack | `climate-project-api-bootstrap` |
| Service stack | `climate-project-api-prod` |
| App Runner ECR access role | `climate-project-apprunner-ecr-access-prod` |
| GitHub OIDC deploy role | `climate-project-github-deploy-prod` |
| Live production URL | https://bhgrdkd4gt.us-east-1.awsapprunner.com |
