using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Profile;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auditing;

/// <summary>
/// The behavioural half of #143. <c>AuditCoverageTests</c> proves the policy says every
/// mutating route is audited; this proves a request that goes through the real pipeline comes
/// out the other side with a row in <c>audit_logs</c> that says who, what and to which row.
///
/// ## Isolation
///
/// Every test signs up its own user, and every assertion filters on that user's id. The suite
/// shares one Postgres and one company per class, so a filter on the company would see rows
/// left by the test before it.
/// </summary>
[Collection("Postgres")]
public class AuditLoggingTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;

    // Its own email domain and its own company row: the suite shares one Postgres and
    // `companies.email_domain` carries a filtered unique index.
    private readonly string _companyDomain = $"audit-{Guid.NewGuid():N}.test";

    private AuthWebApplicationFactory? _factory;
    private Guid _companyId;

    public AuditLoggingTests(PostgresContainerFixture postgres) => _postgres = postgres;

    private AuthWebApplicationFactory Factory => _factory ??= new AuthWebApplicationFactory(_postgres.ConnectionString);

    /// <summary>
    /// A context built straight from the connection string, with none of the application's
    /// interceptors on it. Used for reading rows back and for seeding.
    /// <see cref="Audit_rows_cannot_be_updated"/> deliberately uses the application's own
    /// context instead, because the guard under test is registered there.
    /// </summary>
    private ClimateProjectDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(_postgres.ConnectionString).Options);

    public async Task InitializeAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Audit Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        _factory?.Dispose();
        return Task.CompletedTask;
    }

    private const string SignupPassword = "Sign4upPassword";

    private async Task<(HttpClient Client, Guid UserId)> SignUpAsync(string role)
    {
        var client = Factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";

        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Audit Person", email, SignupPassword));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        await using (var db = CreateContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        // Logged in after the role change so the token carries the new role.
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, SignupPassword));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return (client, userId);
    }

    private async Task<List<AuditLog>> RowsForAsync(Guid userId)
    {
        await using var db = CreateContext();
        return await db.AuditLogs
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .OrderBy(a => a.Timestamp)
            .ThenBy(a => a.Id)
            .ToListAsync();
    }

    // ------------------------------------------------------------------ writing

    /// <summary>
    /// The central claim: a create and an update, over the real pipeline, leave one row each,
    /// naming the actor, the tenant, the derived action and the row acted on.
    /// </summary>
    [Fact]
    public async Task A_create_and_an_update_each_write_one_attributed_row()
    {
        var (client, userId) = await SignUpAsync(Roles.CompanyAdmin);

        var create = await client.PostAsJsonAsync(
            "/admin/departments",
            new CreateDepartmentRequest(_companyId, $"Audited {Guid.NewGuid():N}", null, null, true));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var departmentId = (await create.Content.ReadFromJsonAsync<DepartmentDetail>())!.Id;

        var update = await client.PutAsJsonAsync(
            $"/admin/departments/{departmentId}",
            new UpdateDepartmentRequest("Renamed", null, null));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        var rows = await RowsForAsync(userId);

        Assert.Equal(2, rows.Count);
        Assert.All(rows, row =>
        {
            Assert.Equal(_companyId, row.CompanyId);
            Assert.Equal("admin.departments", row.Resource);
            Assert.Equal(departmentId.ToString(), row.ResourceId);
            Assert.True(row.Success);
            Assert.Null(row.ErrorMessage);
        });

        Assert.Equal("admin.departments.create", rows[0].Action);
        Assert.Equal("admin.departments.update", rows[1].Action);

        // details is the jsonb that says which request it was. Never the body -- see
        // AuditWritingMiddleware.Describe. Parsed rather than substring-matched: the column is
        // jsonb, so Postgres hands back its own normalised spelling of the object, not the
        // bytes that were sent.
        AssertDetails(rows[0].Details, "POST", "/admin/departments", 201);
        AssertDetails(rows[1].Details, "PUT", $"/admin/departments/{departmentId}", 200);
    }

    private static void AssertDetails(string? details, string method, string path, int status)
    {
        var root = JsonDocument.Parse(Assert.IsType<string>(details)).RootElement;

        Assert.Equal(method, root.GetProperty("Method").GetString());
        Assert.Equal(path, root.GetProperty("Path").GetString());
        Assert.Equal(status, root.GetProperty("Status").GetInt32());
    }

    /// <summary>
    /// A refused mutation is recorded as an attempt. This is the half an EF
    /// <c>SaveChanges</c> interceptor could not have covered: the handler returns 403 without
    /// ever calling <c>SaveChangesAsync</c>, so there is no change for an interceptor to see.
    /// </summary>
    [Fact]
    public async Task A_refused_mutation_is_recorded_as_a_failed_attempt()
    {
        var (client, userId) = await SignUpAsync(Roles.CompanyAdmin);

        var refused = await client.PostAsJsonAsync(
            "/admin/departments",
            new CreateDepartmentRequest(Guid.NewGuid(), "Another company's department", null, null, true));

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);

        var row = Assert.Single(await RowsForAsync(userId));

        Assert.Equal("admin.departments.create", row.Action);
        Assert.False(row.Success);
        Assert.Equal("HTTP 403", row.ErrorMessage);

        // Filed under the actor's own company, not the one they asked about -- a caller must
        // not be able to write rows into another tenant's trail by naming it.
        Assert.Equal(_companyId, row.CompanyId);
    }

    /// <summary>
    /// Reads: the marked one is recorded, the unmarked one is not. Both directions matter --
    /// the trail is useless if it misses an export and unreadable if it records every page
    /// view.
    /// </summary>
    [Fact]
    public async Task A_sensitive_read_is_audited_and_an_ordinary_read_is_not()
    {
        var (client, userId) = await SignUpAsync(Roles.CompanyAdmin);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/audit/logs")).StatusCode);
        Assert.Empty(await RowsForAsync(userId));

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/audit/export")).StatusCode);

        var row = Assert.Single(await RowsForAsync(userId));
        Assert.Equal(AuditEndpoints.ExportAction, row.Action);
        Assert.Equal(AuditEndpoints.ExportResource, row.Resource);
        Assert.True(row.Success);
    }

    /// <summary>
    /// The profile routes kept their own vocabulary when #143 took the writing away from them.
    /// One row, not two: a second writer inside the handler would double every profile
    /// mutation, which is what the issue warned against.
    /// </summary>
    [Fact]
    public async Task A_profile_update_writes_one_row_under_the_profile_vocabulary()
    {
        var (client, userId) = await SignUpAsync(Roles.Employee);

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("Renamed Person"))).StatusCode);

        var row = Assert.Single(await RowsForAsync(userId));

        Assert.Equal(ProfileAuditActions.Update, row.Action);
        Assert.Equal(ProfileAuditActions.Resource, row.Resource);
        Assert.Equal(userId.ToString(), row.ResourceId);
        Assert.True(row.Success);
    }

    /// <summary>A failed password change is recorded as one, under the same vocabulary.</summary>
    [Fact]
    public async Task A_failed_password_change_is_recorded_once_and_as_a_failure()
    {
        var (client, userId) = await SignUpAsync(Roles.Employee);

        var wrong = await client.PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest("not-the-current-password", "Rep1acement!"));

        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        var row = Assert.Single(await RowsForAsync(userId));
        Assert.Equal(ProfileAuditActions.PasswordChange, row.Action);
        Assert.Equal(ProfileAuditActions.Resource, row.Resource);
        Assert.False(row.Success);
    }

    // ------------------------------------------------------------------ append-only

    /// <summary>
    /// Resolved from the application's own service provider, so it carries the interceptor
    /// <c>Program.cs</c> registers. <see cref="CreateContext"/> deliberately does not.
    /// </summary>
    private static ClimateProjectDbContext AppContext(IServiceScope scope)
        => scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

    [Fact]
    public async Task Audit_rows_cannot_be_updated()
    {
        var (client, userId) = await SignUpAsync(Roles.Employee);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("Before"))).StatusCode);

        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        var row = await db.AuditLogs.FirstAsync(a => a.UserId == userId);
        row.Action = "tampered";

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        Assert.Contains("append-only", error.Message, StringComparison.Ordinal);

        // And the row is still what it was.
        var rows = await RowsForAsync(userId);
        Assert.Equal(ProfileAuditActions.Update, Assert.Single(rows).Action);
    }

    [Fact]
    public async Task Audit_rows_cannot_be_deleted()
    {
        var (client, userId) = await SignUpAsync(Roles.Employee);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("Before"))).StatusCode);

        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        db.AuditLogs.Remove(await db.AuditLogs.FirstAsync(a => a.UserId == userId));

        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        Assert.Single(await RowsForAsync(userId));
    }

    [Fact]
    public async Task Survey_audit_rows_cannot_be_deleted_either()
    {
        var (surveyId, actorId) = await SeedSurveyTrailAsync();

        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        db.SurveyAuditLogs.Remove(await db.SurveyAuditLogs.FirstAsync(a => a.SurveyId == surveyId));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        Assert.Contains("survey_audit_logs", error.Message, StringComparison.Ordinal);

        Assert.NotEqual(Guid.Empty, actorId);
    }

    // ------------------------------------------------------------------ reading

    [Fact]
    public async Task An_employee_cannot_read_the_trail()
    {
        var (client, _) = await SignUpAsync(Roles.Employee);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/audit/logs")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/audit/export")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/audit/report")).StatusCode);
    }

    /// <summary>
    /// A CompanyAdmin sees their own tenant and cannot widen it by asking. The
    /// <c>companyId</c> parameter is honoured only for SuperAdmin.
    /// </summary>
    [Fact]
    public async Task A_company_admin_cannot_read_another_tenants_rows()
    {
        var (client, userId) = await SignUpAsync(Roles.CompanyAdmin);

        var (otherCompanyId, otherRowId) = await SeedForeignAuditRowAsync();

        // A row of our own to prove the endpoint is returning anything at all.
        Assert.Equal(
            HttpStatusCode.Created,
            (await client.PostAsJsonAsync(
                "/admin/departments",
                new CreateDepartmentRequest(_companyId, $"Visible {Guid.NewGuid():N}", null, null, true))).StatusCode);

        var page = await ReadPageAsync(client, $"/audit/logs?companyId={otherCompanyId}");

        Assert.Contains(page.Items, i => i.UserId == userId);
        Assert.DoesNotContain(page.Items, i => i.Id == otherRowId);
    }

    /// <summary>
    /// The entity trail returns both tables for a survey, tagged by source. This is what
    /// "reconciled, not two trails" means in practice: one ordered list, not a second endpoint
    /// the reader has to know about.
    /// </summary>
    [Fact]
    public async Task The_entity_trail_merges_the_general_and_survey_records()
    {
        var (client, _) = await SignUpAsync(Roles.CompanyAdmin);
        var (surveyId, _) = await SeedSurveyTrailAsync();

        var response = await client.GetAsync($"/audit/surveys/{surveyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var items = (await response.Content.ReadFromJsonAsync<List<AuditLogItem>>())!;

        var surveyRow = Assert.Single(items, i => i.Source == AuditSources.Survey);
        Assert.Equal("published", surveyRow.Action);
        Assert.Equal(surveyId.ToString(), surveyRow.ResourceId);
    }

    private async Task<AuditLogPage> ReadPageAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AuditLogPage>())!;
    }

    // ------------------------------------------------------------------ seeding

    /// <summary>An audit row belonging to a company this class's users are not in.</summary>
    private async Task<(Guid CompanyId, Guid RowId)> SeedForeignAuditRowAsync()
    {
        await using var db = CreateContext();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Other Co",
            EmailDomain = $"other-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);

        var row = new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = null,
            CompanyId = company.Id,
            Action = "other.create",
            Resource = "other",
            Success = true,
            Timestamp = DateTimeOffset.UtcNow,
        };
        db.AuditLogs.Add(row);

        await db.SaveChangesAsync();
        return (company.Id, row.Id);
    }

    /// <summary>
    /// A survey in this class's company with one <c>survey_audit_logs</c> row, seeded directly.
    /// Driving <c>POST /surveys</c> plus a publish would exercise <c>SurveyEndpoints</c>, which
    /// these tests are not about.
    /// </summary>
    private async Task<(Guid SurveyId, Guid ActorId)> SeedSurveyTrailAsync()
    {
        await using var db = CreateContext();

        var now = DateTimeOffset.UtcNow;
        var actor = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Email = $"{Guid.NewGuid():N}@{_companyDomain}",
            Name = "Survey Author",
            Role = Roles.CompanyAdmin,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(actor);

        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            CreatedBy = actor.Id,
            TitleEn = "Audited survey",
            Type = "general_climate",
            Language = "en",
            StartDate = now,
            EndDate = now.AddDays(7),
            Status = "active",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);

        db.SurveyAuditLogs.Add(new SurveyAuditLog
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            Action = "published",
            EntityType = "survey",
            EntityId = survey.Id.ToString(),
            UserId = actor.Id,
            UserName = actor.Name,
            UserEmail = actor.Email,
            UserRole = actor.Role,
            Timestamp = now,
        });

        await db.SaveChangesAsync();
        return (survey.Id, actor.Id);
    }
}
