# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Build provenance, surfaced by GET /version so a running instance can be traced
# back to the commit it was built from. Defaulted to "unknown" so a bare
# `docker build .` still works; deploy-prod.yml passes the real values.
ARG COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown

COPY . .
RUN dotnet restore ClimateProject.slnx
RUN dotnet publish src/ClimateProject.Api/ClimateProject.Api.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore \
    /p:UseAppHost=false \
    "/p:CommitSha=${COMMIT_SHA}" \
    "/p:BuildTimestamp=${BUILD_TIMESTAMP}"

# Must not be an Alpine variant. Since #136 the API resolves timezone ids at runtime
# (ProfilePreferenceUpdate.IsValidTimezone, on PUT /profile/preferences), and Alpine ships
# without tzdata -- every IANA zone id would fail to resolve and users would be unable to
# set any timezone but UTC. Since #275 the constraint is doubly load-bearing: this image
# co-hosts the scheduled jobs (the API references ClimateProject.Workers and calls
# AddClimateProjectScheduling), and the digest scheduler resolves each recipient's timezone,
# where missing tzdata fails silently instead of with a 400. This is also why nothing needs
# to build Dockerfile.workers any more -- the publish below carries the Workers assembly.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:8080
ENV DOTNET_EnableDiagnostics=0

EXPOSE 8080

COPY --from=build /app/publish .

USER $APP_UID

ENTRYPOINT ["dotnet", "ClimateProject.Api.dll"]
