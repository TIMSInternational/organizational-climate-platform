using ClimateProject.DataMigration.Loading;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Bson;
using MongoDB.Driver;
using Testcontainers.MongoDb;
using Testcontainers.PostgreSql;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// One Mongo and one Postgres container for the whole class - a container per test
/// case is the mistake #279 existed to stop. Each test gets its own logical Mongo
/// database; Postgres state is reset per test by deleting from the five loaded tables
/// (child-first), because the schema comes from the real EF migrations.
/// </summary>
public sealed class EtlContainersFixture : IAsyncLifetime
{
    private readonly MongoDbContainer _mongo = new MongoDbBuilder("mongo:7.0").Build();
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("etl_target").WithUsername("postgres").WithPassword("postgres").Build();

    public MongoClient Mongo { get; private set; } = null!;

    public string PostgresConnectionString => _postgres.GetConnectionString();

    public ClimateProjectDbContext CreateDb()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(PostgresConnectionString).Options);

    public async Task ResetTargetAsync()
    {
        await using var db = CreateDb();
        await db.Database.ExecuteSqlRawAsync(
            """
            DELETE FROM user_demographics;
            DELETE FROM demographic_field_options;
            DELETE FROM users;
            DELETE FROM departments;
            DELETE FROM demographic_fields;
            DELETE FROM system_settings;
            DELETE FROM companies;
            """);
    }

    public async Task InitializeAsync()
    {
        await Task.WhenAll(_mongo.StartAsync(), _postgres.StartAsync());
        Mongo = new MongoClient(_mongo.GetConnectionString());
        await using var db = CreateDb();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await _mongo.DisposeAsync();
        await _postgres.DisposeAsync();
    }
}

public class PipelineTests : IClassFixture<EtlContainersFixture>
{
    private readonly EtlContainersFixture _fx;

    public PipelineTests(EtlContainersFixture fixture) => _fx = fixture;

    private static readonly ObjectId AcmeOid = ObjectId.Parse("64b000000000000000000001");
    private static readonly ObjectId EngOid = ObjectId.Parse("64b000000000000000000011");
    private static readonly ObjectId ApiOid = ObjectId.Parse("64b000000000000000000012");
    private static readonly ObjectId AdaOid = ObjectId.Parse("64b000000000000000000021");
    private static readonly ObjectId GraceOid = ObjectId.Parse("64b000000000000000000022");
    private static readonly ObjectId RootOid = ObjectId.Parse("64b000000000000000000023");
    private static readonly ObjectId TenureOid = ObjectId.Parse("64b000000000000000000031");

    /// <summary>The fixture corpus: every FK edge, both second passes, one of each misfit.</summary>
    private static async Task SeedLegacyAsync(IMongoDatabase legacy)
    {
        await legacy.GetCollection<BsonDocument>("companies").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = AcmeOid, ["name"] = "Acme Inc", ["domain"] = "acme.com",
                ["settings"] = new BsonDocument { ["language"] = "en" },
                ["created_at"] = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            },
        ]);

        await legacy.GetCollection<BsonDocument>("demographicfields").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = TenureOid, ["company_id"] = AcmeOid.ToString(),
                ["field"] = "tenure", ["label"] = "Tenure", ["type"] = "select",
                ["options"] = new BsonArray { "0-1", "1-3" },
            },
        ]);

        await legacy.GetCollection<BsonDocument>("departments").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = EngOid, ["name"] = "Engineering", ["company_id"] = AcmeOid.ToString(),
                ["manager_id"] = GraceOid.ToString(),
                ["hierarchy"] = new BsonDocument { ["level"] = 0, ["path"] = "engineering" },
            },
            new BsonDocument
            {
                ["_id"] = ApiOid, ["name"] = "Backend API", ["company_id"] = AcmeOid.ToString(),
                ["hierarchy"] = new BsonDocument
                {
                    ["parent_department_id"] = EngOid.ToString(),
                    ["level"] = 1,
                    ["path"] = "engineering/backend-api",
                },
            },
        ]);

        await legacy.GetCollection<BsonDocument>("users").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = AdaOid, ["name"] = "Ada Lovelace", ["email"] = "ada@acme.com",
                ["role"] = "employee", ["company_id"] = AcmeOid.ToString(),
                ["department_id"] = ApiOid.ToString(),
                ["manager_id"] = GraceOid.ToString(),
                ["demographics"] = new BsonDocument { ["tenure"] = "1-3", ["unknown_key"] = "x" },
                ["preferences"] = new BsonDocument
                {
                    ["notification_settings"] = new BsonDocument { ["email_reminders"] = false },
                },
            },
            new BsonDocument
            {
                ["_id"] = GraceOid, ["name"] = "Grace Hopper", ["email"] = "grace@acme.com",
                ["role"] = "department_admin", ["company_id"] = AcmeOid.ToString(),
                ["department_id"] = EngOid.ToString(),
            },
            new BsonDocument
            {
                ["_id"] = RootOid, ["name"] = "Root", ["email"] = "root@platform.example",
                ["role"] = "super_admin",
            },
        ]);

        await legacy.GetCollection<BsonDocument>("systemsettings").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = ObjectId.Parse("64b000000000000000000041"),
                ["login_enabled"] = true, ["maintenance_mode"] = false,
                ["maintenance_message"] = "Back soon.",
            },
        ]);
    }

    private async Task<(MigrationResult Result, DataQualityReport Report)> RunAsync(
        IMongoDatabase legacy, CancellationToken ct = default)
    {
        await using var db = _fx.CreateDb();
        var report = new DataQualityReport();
        var pipeline = new MigrationPipeline(legacy, db, report, dryRun: false);
        var result = await pipeline.RunAsync([], ct);
        return (result, report);
    }

    [Fact]
    public async Task Full_load_satisfies_every_edge_and_reconciles_exactly()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("full_load");
        await SeedLegacyAsync(legacy);

        var (result, report) = await RunAsync(legacy);
        result.AssertReconciled();

        await using var db = _fx.CreateDb();

        var ada = await db.Users.SingleAsync(u => u.Email == "ada@acme.com");
        var grace = await db.Users.SingleAsync(u => u.Email == "grace@acme.com");
        var api = await db.Departments.SingleAsync(d => d.Name == "Backend API");
        var eng = await db.Departments.SingleAsync(d => d.Name == "Engineering");

        // Second passes: parent chain, department manager, user manager.
        Assert.Equal(eng.Id, api.ParentDepartmentId);
        Assert.Equal(grace.Id, eng.ManagerId);
        Assert.Equal(grace.Id, ada.ManagerId);

        // #155 backfill: the raw legacy hex rides on both identity columns.
        Assert.Equal(AdaOid.ToString(), ada.PersonaExternalId);
        Assert.Equal(EngOid.ToString(), eng.LegacyExternalId);

        // #192: the present opt-out survives, the absent five stay at defaults.
        Assert.False(ada.Notifications.EmailReminders);
        Assert.True(ada.Notifications.EmailSurveys);

        // department_admin remap landed and was reported by name.
        Assert.Equal("leader", grace.Role);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.RoleDepartmentAdminRemapped);

        // #193: resolved key fanned out; unknown key reported, not dropped in silence.
        var demographic = await db.UserDemographics.SingleAsync(d => d.UserId == ada.Id);
        Assert.Equal("1-3", demographic.Value);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DemographicKeyUnresolved);

        // The recomputed hierarchy agrees with the legacy derived values: no findings.
        Assert.DoesNotContain(report.Entries, e => e.Rule == MigrationRules.DepartmentHierarchyMismatch);

        // Attribution: en company label, plus the platform maintenance message.
        Assert.Equal(2, report.Entries.Count(e => e.Kind == ReportEntryKind.Attribution));
    }

    [Fact]
    public async Task Running_twice_converges_and_never_rekeys_a_security_stamp()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("idempotency");
        await SeedLegacyAsync(legacy);

        await RunAsync(legacy);

        Guid stampAfterFirstRun;
        int usersAfterFirstRun;
        await using (var db = _fx.CreateDb())
        {
            stampAfterFirstRun = (await db.Users.SingleAsync(u => u.Email == "ada@acme.com")).SecurityStamp;
            usersAfterFirstRun = await db.Users.CountAsync();
        }

        var (second, _) = await RunAsync(legacy);
        second.AssertReconciled();

        await using (var db = _fx.CreateDb())
        {
            Assert.Equal(usersAfterFirstRun, await db.Users.CountAsync());
            Assert.Equal(1, await db.UserDemographics.CountAsync(d => d.Value == "1-3"));
            // Sub-issue D's sharpest AC: a re-run must not end anyone's session.
            Assert.Equal(stampAfterFirstRun,
                (await db.Users.SingleAsync(u => u.Email == "ada@acme.com")).SecurityStamp);
        }
    }

    [Fact]
    public async Task Interrupted_run_restarted_converges_to_the_uninterrupted_state()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("interruption");
        await SeedLegacyAsync(legacy);

        // Writes persist once per stage, so the ONLY partial state a kill can leave
        // behind is a stage boundary - a death mid-collection rolls its stage back to
        // exactly this. Construct that state directly: everything up to departments
        // loaded (their second pass unresolved because users never arrived), users and
        // systemsettings never run.
        await using (var db = _fx.CreateDb())
        {
            var pipeline = new MigrationPipeline(legacy, db, new DataQualityReport(), dryRun: false);
            var partial = await pipeline.RunAsync(["companies", "demographicfields", "departments"], CancellationToken.None);
            partial.AssertReconciled();
        }

        await using (var check = _fx.CreateDb())
        {
            Assert.Equal(0, await check.Users.CountAsync());
            Assert.Null((await check.Departments.SingleAsync(d => d.Name == "Engineering")).ManagerId);
        }

        // And a token canceled before the run starts is honored before anything writes.
        await using (var db = _fx.CreateDb())
        {
            var pipeline = new MigrationPipeline(legacy, db, new DataQualityReport(), dryRun: false);
            await Assert.ThrowsAnyAsync<OperationCanceledException>(
                () => pipeline.RunAsync([], new CancellationToken(canceled: true)));
        }

        // Naive restart, no flags: deterministic ids make "run again" the recovery.
        var (result, _) = await RunAsync(legacy);
        result.AssertReconciled();

        await using (var verify = _fx.CreateDb())
        {
            Assert.Equal(1, await verify.Companies.CountAsync());
            Assert.Equal(2, await verify.Departments.CountAsync());
            Assert.Equal(3, await verify.Users.CountAsync());
            var api = await verify.Departments.SingleAsync(d => d.Name == "Backend API");
            Assert.NotNull(api.ParentDepartmentId);
            var eng = await verify.Departments.SingleAsync(d => d.Name == "Engineering");
            Assert.NotNull(eng.ManagerId);
        }
    }

    [Fact]
    public async Task Dry_run_reports_everything_and_persists_nothing()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("dry_run");
        await SeedLegacyAsync(legacy);

        await using var db = _fx.CreateDb();
        var report = new DataQualityReport();
        var pipeline = new MigrationPipeline(legacy, db, report, dryRun: true);
        var result = await pipeline.RunAsync([], CancellationToken.None);
        result.AssertReconciled();

        Assert.NotEmpty(report.Entries);
        await using var verify = _fx.CreateDb();
        Assert.Equal(0, await verify.Companies.CountAsync());
        Assert.Equal(0, await verify.Users.CountAsync());
    }

    [Fact]
    public async Task Unmapped_collection_is_refused_by_name_not_ignored()
    {
        var legacy = _fx.Mongo.GetDatabase("refusal");
        await using var db = _fx.CreateDb();
        var pipeline = new MigrationPipeline(legacy, db, new DataQualityReport(), dryRun: true);

        var exception = await Assert.ThrowsAsync<NotSupportedException>(
            () => pipeline.RunAsync(["companies", "responses"], CancellationToken.None));
        Assert.Contains("responses", exception.Message);
    }

    [Fact]
    public void Transaction_pooler_connection_string_is_refused_before_anything_connects()
    {
        var options = new MigrationOptions(
            DryRun: true, Collections: [], ReportPath: "r.json",
            MongoUri: "mongodb://localhost", MongoDatabase: "x",
            PostgresConnectionString: "Host=aws-0-us-east-1.pooler.supabase.com;Port=6543;Database=postgres");

        var exception = Assert.Throws<InvalidOperationException>(options.AssertPostgresIsNotTransactionPooler);
        Assert.Contains("6543", exception.Message);
    }
}
