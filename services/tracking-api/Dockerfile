# syntax=docker/dockerfile:1
#
# The climate-tracking-api production image. Refs #219.
#
# BUILD CONTEXT IS services/tracking-api, NOT THE REPOSITORY ROOT:
#
#   docker build --platform linux/amd64 -f services/tracking-api/Dockerfile services/tracking-api
#
# because `dotnet restore ClimateTracking.slnx` needs that solution, that
# Directory.Build.props and that global.json to be at WORKDIR. Building from the
# repository root would copy the whole monorepo -- both .NET solutions and all of
# web/ -- into the build context for no benefit.
#
# `--platform linux/amd64` IS REQUIRED and is not decoration. Docker on Apple
# Silicon builds linux/arm64 by default; App Runner only runs linux/amd64. An
# image built without the flag pushes and deploys "successfully" and then the
# service fails to start or crash-loops. That cost climate-project two 19-minute
# failed deploys during its initial rollout (infra/aws/README.md, manual path,
# step 3). The deploy workflow always passes it; pass it by hand too.
#
# NOT AN ALPINE VARIANT. climate-project's Dockerfile has two load-bearing reasons
# for this (runtime IANA timezone resolution in #136 and #275); THIS service has
# neither -- nothing under services/tracking-api/src references TimeZoneInfo,
# checked 2026-08-24. It matches anyway, because "the two images differ only where
# they must" is worth more than the ~90MB, and because the day someone adds a
# per-recipient notification hour to DailySemaforoWorker, an Alpine base would fail
# it silently rather than loudly.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Build provenance, surfaced by GET /version so a running instance can be traced
# back to the commit it was built from. Defaulted to "unknown" so a bare
# `docker build` still works; deploy-tracking-prod.yml passes the real values.
#
# THESE ARE WIRED AHEAD OF THE CODE THAT READS THEM. As of 2026-08-24
# ClimateTracking.Api has no BuildInfo and its /version returns
# {service, runtime, environment} with no `commit` field, so these properties are
# set on the build and nothing consumes them yet. That is deliberate and harmless
# -- MSBuild ignores a property no target reads -- and it means the "Verify
# deployed commit matches this run" step in the deploy workflow starts working the
# moment the source side lands, with no change here. Until then that step fails,
# by design: scripts/read-deployed-commit.sh requires a 40-hex `.commit` and
# refuses to treat a missing one as a mundane mismatch.
ARG COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown

COPY . .
RUN dotnet restore ClimateTracking.slnx
RUN dotnet publish src/ClimateTracking.Api/ClimateTracking.Api.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore \
    /p:UseAppHost=false \
    "/p:CommitSha=${COMMIT_SHA}" \
    "/p:BuildTimestamp=${BUILD_TIMESTAMP}"

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:8080
ENV DOTNET_EnableDiagnostics=0

EXPOSE 8080

COPY --from=build /app/publish .

USER $APP_UID

# ONE PROCESS, TWO JOBS. This entrypoint is ClimateTracking.Api, and under the
# deployment #219 chose it is also the host for CacheSyncWorker and
# DailySemaforoWorker -- the same shape #275 chose for climate-project, where the
# API image IS the scheduler and Dockerfile.workers is kept unbuilt as the
# documented opt-out.
#
# That requires ClimateTracking.Api to reference ClimateTracking.Workers and
# register the two hosted services, which it does NOT do as of 2026-08-24. Until
# it does, this image serves the HTTP API and syncs nothing: the four *_cache
# tables stay empty, so every plan row and every .xlsx cell that needs a nodo or
# persona NAME renders blank, and no 30-day/15-day/vencimiento notification is
# ever sent.
#
# The alternative -- a second App Runner service built from a Workers image -- is
# not a preference that was rejected, it is not available: App Runner requires the
# container to listen on the configured port and pass an HTTP or TCP health check,
# and ClimateTracking.Workers is a Host, not a WebApplication, so it never binds a
# port at all. See docs/runbooks/tracking-service-provisioning.md.
ENTRYPOINT ["dotnet", "ClimateTracking.Api.dll"]
