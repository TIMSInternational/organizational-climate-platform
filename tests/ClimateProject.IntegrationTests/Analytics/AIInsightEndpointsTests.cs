using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Analytics;

/// <summary>
/// Covers <c>/admin/ai-insights</c> -- the routes <c>web/src/features/analytics/api/insights.ts</c>
/// pinned before the backend existed. Two companies are seeded rather than one because the
/// interesting half of this endpoint is the denial: an AI insight names departments and
/// segments, so a cross-tenant read is a disclosure, not just a bug.
/// </summary>
[Collection("Postgres")]
public class AIInsightEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"aia-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"aib-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _surveyAId;
    private Guid _surveyBId;
    private Guid _departmentAId;
    private Guid _departmentBId;

    public AIInsightEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;

        var companyA = new Company { Id = Guid.NewGuid(), Name = "AI Co A", EmailDomain = _companyADomain, CreatedAt = now };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "AI Co B", EmailDomain = _companyBDomain, CreatedAt = now };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();

        var departmentA = new Department { Id = Guid.NewGuid(), CompanyId = companyA.Id, Name = "Engineering", CreatedAt = now, UpdatedAt = now };
        var departmentB = new Department { Id = Guid.NewGuid(), CompanyId = companyB.Id, Name = "Sales", CreatedAt = now, UpdatedAt = now };
        db.Departments.AddRange(departmentA, departmentB);
        _departmentAId = departmentA.Id;
        _departmentBId = departmentB.Id;
        await db.SaveChangesAsync();

        var authorA = await SeedUserAsync(db, companyA.Id);
        var authorB = await SeedUserAsync(db, companyB.Id);
        _surveyAId = await SeedSurveyAsync(db, companyA.Id, authorA);
        _surveyBId = await SeedSurveyAsync(db, companyB.Id, authorB);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<Guid> SeedUserAsync(ClimateProjectDbContext db, Guid companyId)
    {
        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Email = $"member-{Guid.NewGuid():N}@member.test",
            Name = "Member",
            Role = Roles.Employee,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private static async Task<Guid> SeedSurveyAsync(ClimateProjectDbContext db, Guid companyId, Guid createdBy)
    {
        var now = DateTimeOffset.UtcNow;
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEn = "Annual climate survey",
            Language = "en",
            Type = "general_climate",
            StartDate = now,
            EndDate = now.AddDays(14),
            Status = "draft",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return survey.Id;
    }

    private async Task<(string Token, string Email)> SignUpAndGetTokenAsync(
        HttpClient client, string role, string emailDomain, Guid? companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }

            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return ((await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token, email);
    }

    private async Task<HttpClient> ClientAsync(string role, string domain, Guid? companyId = null)
    {
        var (client, _) = await ClientWithEmailAsync(role, domain, companyId);
        return client;
    }

    private async Task<(HttpClient Client, string Email)> ClientWithEmailAsync(string role, string domain, Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var (token, email) = await SignUpAndGetTokenAsync(client, role, domain, companyId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (client, email);
    }

    private static CreateAIInsightRequest CreateRequest(
        Guid companyId,
        string title = "Declining engagement in Sales",
        Guid? surveyId = null,
        Guid? departmentId = null,
        string type = "trend",
        string category = "engagement",
        string description = "Engagement fell nine points quarter over quarter.",
        int confidenceScore = 80,
        string priority = "high",
        IReadOnlyList<string>? affectedSegments = null,
        IReadOnlyList<string>? recommendedActions = null)
        => new(surveyId, companyId, departmentId, type, category, title, description, confidenceScore,
            priority, affectedSegments ?? ["Sales"], recommendedActions ?? ["Schedule 1:1s"]);

    private async Task<AIInsightDetail> CreateInsightAsync(HttpClient client, CreateAIInsightRequest request)
    {
        var response = await client.PostAsJsonAsync("/admin/ai-insights", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AIInsightDetail>())!;
    }

    [Fact]
    public async Task Create_stores_the_insight_unacknowledged_and_get_returns_it()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var created = await CreateInsightAsync(client, CreateRequest(
            _companyAId, surveyId: _surveyAId, departmentId: _departmentAId,
            affectedSegments: ["Sales", "Support"], recommendedActions: ["Schedule 1:1s", "Review workload"]));

        Assert.Equal(_companyAId, created.CompanyId);
        Assert.Equal(_surveyAId, created.SurveyId);
        Assert.Equal(_departmentAId, created.DepartmentId);
        Assert.Equal(80, created.ConfidenceScore);
        Assert.Equal(new[] { "Sales", "Support" }, created.AffectedSegments);
        Assert.Equal(new[] { "Schedule 1:1s", "Review workload" }, created.RecommendedActions);
        // Acknowledgement is never accepted from the request body -- only from the ack verb.
        Assert.False(created.IsAcknowledged);
        Assert.Null(created.AcknowledgedBy);
        Assert.Null(created.AcknowledgedAt);

        var fetched = (await (await client.GetAsync($"/admin/ai-insights/{created.Id}")).Content
            .ReadFromJsonAsync<AIInsightDetail>())!;
        Assert.Equal(created.Id, fetched.Id);
        Assert.Equal("Declining engagement in Sales", fetched.Title);
        Assert.Equal("Engagement fell nine points quarter over quarter.", fetched.Description);
        Assert.Equal(new[] { "Sales", "Support" }, fetched.AffectedSegments);
    }

    [Fact]
    public async Task The_json_keys_are_the_ones_the_shipped_web_client_reads()
    {
        // web/src/features/analytics/api/insights.ts was written before this endpoint existed and
        // ships today against /analytics/ai-insights. Deserialising into the C# record proves
        // nothing about the wire -- both sides would move together -- so the property names are
        // asserted against the raw JSON. If one of these fails, the page breaks, not the test.
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await CreateInsightAsync(client, CreateRequest(_companyAId, surveyId: _surveyAId));
        await client.PostAsync($"/admin/ai-insights/{created.Id}/acknowledge", null);

        using var detail = JsonDocument.Parse(
            await (await client.GetAsync($"/admin/ai-insights/{created.Id}")).Content.ReadAsStringAsync());
        var expectedDetailKeys = new[]
        {
            "id", "surveyId", "companyId", "departmentId", "type", "category", "title", "description",
            "confidenceScore", "priority", "affectedSegments", "recommendedActions", "isAcknowledged",
            "acknowledgedBy", "acknowledgedAt",
        };
        Assert.Equal(expectedDetailKeys, detail.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Equal(JsonValueKind.Array, detail.RootElement.GetProperty("affectedSegments").ValueKind);
        // The TS interface types this as a number 0-100, not a 0-1 fraction (#152).
        Assert.Equal(80, detail.RootElement.GetProperty("confidenceScore").GetInt32());
        Assert.Equal(JsonValueKind.String, detail.RootElement.GetProperty("acknowledgedBy").ValueKind);

        using var list = JsonDocument.Parse(
            await (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).Content.ReadAsStringAsync());
        var row = list.RootElement.EnumerateArray().Single();
        Assert.Equal(
            new[] { "id", "companyId", "type", "category", "title", "priority", "isAcknowledged" },
            row.EnumerateObject().Select(p => p.Name));
    }

    [Fact]
    public async Task Acknowledge_records_who_and_when()
    {
        var (client, email) = await ClientWithEmailAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await CreateInsightAsync(client, CreateRequest(_companyAId));

        var before = DateTimeOffset.UtcNow;
        var ackResponse = await client.PostAsync($"/admin/ai-insights/{created.Id}/acknowledge", null);
        Assert.Equal(HttpStatusCode.OK, ackResponse.StatusCode);
        var acked = (await ackResponse.Content.ReadFromJsonAsync<AIInsightDetail>())!;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var acknowledger = await db.Users.AsNoTracking().FirstAsync(u => u.Email == email);

        Assert.True(acked.IsAcknowledged);
        // "Who" is the caller resolved from the token, not Guid.Empty and not the insight's
        // author -- #95 attributes the dismissal by this id.
        Assert.Equal(acknowledger.Id, acked.AcknowledgedBy);
        Assert.NotNull(acked.AcknowledgedAt);
        Assert.InRange(acked.AcknowledgedAt!.Value, before.AddSeconds(-5), DateTimeOffset.UtcNow.AddSeconds(5));

        // And it is durable, not just echoed back by the handler.
        var stored = await db.AIInsights.AsNoTracking().FirstAsync(i => i.Id == created.Id);
        Assert.True(stored.IsAcknowledged);
        Assert.Equal(acknowledger.Id, stored.AcknowledgedBy);
        Assert.NotNull(stored.AcknowledgedAt);
    }

    [Fact]
    public async Task Acknowledging_twice_keeps_the_first_acknowledger_and_timestamp()
    {
        var (first, firstEmail) = await ClientWithEmailAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await CreateInsightAsync(first, CreateRequest(_companyAId));

        var firstAck = (await (await first.PostAsync($"/admin/ai-insights/{created.Id}/acknowledge", null)).Content
            .ReadFromJsonAsync<AIInsightDetail>())!;

        // A different admin in the same company clicks the same row a moment later. The audit
        // record must still name the admin who actually made the call that flipped the flag --
        // a second POST is a retry, not a second sign-off.
        await Task.Delay(50);
        var (second, secondEmail) = await ClientWithEmailAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var secondResponse = await second.PostAsync($"/admin/ai-insights/{created.Id}/acknowledge", null);
        Assert.Equal(HttpStatusCode.OK, secondResponse.StatusCode);
        var secondAck = (await secondResponse.Content.ReadFromJsonAsync<AIInsightDetail>())!;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var firstUser = await db.Users.AsNoTracking().FirstAsync(u => u.Email == firstEmail);
        var secondUser = await db.Users.AsNoTracking().FirstAsync(u => u.Email == secondEmail);

        var stored = await db.AIInsights.AsNoTracking().FirstAsync(i => i.Id == created.Id);

        Assert.Equal(firstUser.Id, firstAck.AcknowledgedBy);
        Assert.Equal(firstUser.Id, secondAck.AcknowledgedBy);
        Assert.NotEqual(secondUser.Id, secondAck.AcknowledgedBy);
        Assert.Equal(firstUser.Id, stored.AcknowledgedBy);

        // Both of these have been through Postgres, so they are exactly comparable.
        Assert.Equal(stored.AcknowledgedAt, secondAck.AcknowledgedAt);

        // firstAck.AcknowledgedAt has NOT: it is the in-memory DateTimeOffset.UtcNow from
        // the first call, returned off the still-tracked entity before any round trip. .NET
        // ticks are 100 ns and timestamptz truncates to 1 us, so asserting exact equality
        // here is a coin flip on the clock resolution of whatever machine runs it — 0 of 200
        // UtcNow samples carry a sub-microsecond remainder on macOS, but 178 of 200 do inside
        // the Linux .NET SDK image, and every CI job is ubuntu-latest. This assertion was
        // exactly equal and would have been ~89% red on CI.
        //
        // The tolerance does not weaken the claim. What this test is actually asserting is
        // that the second POST did not overwrite the timestamp — and the Task.Delay(50) above
        // means an overwrite would move it by ~50 ms, five orders of magnitude beyond 1 ms.
        var drift = (secondAck.AcknowledgedAt!.Value - firstAck.AcknowledgedAt!.Value).Duration();
        Assert.True(
            drift < TimeSpan.FromMilliseconds(1),
            $"the second acknowledgement moved the timestamp by {drift.TotalMilliseconds} ms; "
                + "a retry must not re-stamp it");
    }

    [Fact]
    public async Task List_returns_only_the_requested_companys_insights_newest_first()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var mine = await CreateInsightAsync(superAdmin, CreateRequest(_companyAId, "Mine"));
        var theirs = await CreateInsightAsync(superAdmin, CreateRequest(_companyBId, "Theirs"));

        var list = (await (await superAdmin.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AIInsightListItem>>())!;

        Assert.Contains(list, i => i.Id == mine.Id);
        Assert.DoesNotContain(list, i => i.Id == theirs.Id);
        Assert.All(list, i => Assert.Equal(_companyAId, i.CompanyId));

        var row = Assert.Single(list, i => i.Id == mine.Id);
        Assert.Equal("Mine", row.Title);
        Assert.Equal("trend", row.Type);
        Assert.Equal("engagement", row.Category);
        Assert.Equal("high", row.Priority);
        Assert.False(row.IsAcknowledged);
    }

    [Fact]
    public async Task List_is_ordered_newest_first_and_is_stable_when_rows_tie_on_created_at()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var older = await CreateInsightAsync(client, CreateRequest(_companyAId, "Older"));
        var newer = await CreateInsightAsync(client, CreateRequest(_companyAId, "Newer"));

        // A generation run (#92) writes a batch that shares CreatedAt to the tick, which is
        // exactly when the ThenBy(Id) tiebreak stops the list reshuffling between refetches.
        var tied = new List<Guid>();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var sameInstant = new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.Zero);
            var olderRow = await db.AIInsights.FirstAsync(i => i.Id == older.Id);
            olderRow.CreatedAt = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
            var newerRow = await db.AIInsights.FirstAsync(i => i.Id == newer.Id);
            newerRow.CreatedAt = new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero);
            for (var i = 0; i < 5; i++)
            {
                var batchMember = await CreateInsightAsync(client, CreateRequest(_companyAId, $"Batch {i}"));
                tied.Add(batchMember.Id);
                var batchRow = await db.AIInsights.FirstAsync(r => r.Id == batchMember.Id);
                batchRow.CreatedAt = sameInstant;
            }

            await db.SaveChangesAsync();
        }

        var first = (await (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AIInsightListItem>>())!;
        var second = (await (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AIInsightListItem>>())!;

        var ids = first.Select(i => i.Id).ToList();
        Assert.True(ids.IndexOf(newer.Id) < ids.IndexOf(tied[0]), "newest insight should sort ahead of the tied batch");
        Assert.True(ids.IndexOf(tied[0]) < ids.IndexOf(older.Id), "tied batch should sort ahead of the oldest insight");

        // Only stability is asserted for the tied rows, not a particular permutation: Postgres
        // orders uuid by raw byte order and Guid.CompareTo does not, so "sorted" means something
        // different on each side of the wire.
        Assert.Equal(ids, second.Select(i => i.Id));
    }

    [Fact]
    public async Task List_can_filter_to_outstanding_insights_only()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var outstanding = await CreateInsightAsync(client, CreateRequest(_companyAId, "Outstanding"));
        var handled = await CreateInsightAsync(client, CreateRequest(_companyAId, "Handled"));
        await client.PostAsync($"/admin/ai-insights/{handled.Id}/acknowledge", null);

        var open = (await (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}&isAcknowledged=false")).Content
            .ReadFromJsonAsync<List<AIInsightListItem>>())!;
        Assert.Contains(open, i => i.Id == outstanding.Id);
        Assert.DoesNotContain(open, i => i.Id == handled.Id);

        // The page the contract was written for passes no filter, so the default must be "all".
        var unfiltered = (await (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AIInsightListItem>>())!;
        Assert.Contains(unfiltered, i => i.Id == handled.Id);
        Assert.Contains(unfiltered, i => i.Id == outstanding.Id);
        Assert.True(Assert.Single(unfiltered, i => i.Id == handled.Id).IsAcknowledged);
    }

    [Fact]
    public async Task Expired_insights_are_still_listed_unlike_the_report_section()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var expired = await CreateInsightAsync(client, CreateRequest(_companyAId, "Expired"));

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.AIInsights.FirstAsync(i => i.Id == expired.Id);
            row.ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1);
            await db.SaveChangesAsync();
        }

        // ReportAIInsights.ForCompany drops these so a generated report does not reprint a stale
        // finding. The admin console is the record, and a row GET /{id} still returns must not
        // vanish from the only page that links to it.
        var list = (await (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AIInsightListItem>>())!;
        Assert.Contains(list, i => i.Id == expired.Id);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/admin/ai-insights/{expired.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_CompanyAdmin_cannot_list_another_companys_insights()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/admin/ai-insights?companyId={_companyBId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_CompanyAdmin_cannot_read_or_acknowledge_another_companys_insight()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var companyBInsight = await CreateInsightAsync(superAdmin, CreateRequest(_companyBId, "Company B attrition risk"));

        var companyAAdmin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var getResponse = await companyAAdmin.GetAsync($"/admin/ai-insights/{companyBInsight.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);
        // The prose must not leak in the denial body either.
        Assert.DoesNotContain("attrition", await getResponse.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        var ackResponse = await companyAAdmin.PostAsync($"/admin/ai-insights/{companyBInsight.Id}/acknowledge", null);
        Assert.Equal(HttpStatusCode.Forbidden, ackResponse.StatusCode);

        // And nothing landed: the denial must be a denial, not a 403 after a write.
        var asSuperAdmin = (await (await superAdmin.GetAsync($"/admin/ai-insights/{companyBInsight.Id}")).Content
            .ReadFromJsonAsync<AIInsightDetail>())!;
        Assert.False(asSuperAdmin.IsAcknowledged);
        Assert.Null(asSuperAdmin.AcknowledgedBy);
    }

    [Fact]
    public async Task A_CompanyAdmin_cannot_create_an_insight_for_another_company()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.PostAsJsonAsync("/admin/ai-insights", CreateRequest(_companyBId, "Cross Tenant"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_insight_cannot_be_filed_against_another_tenants_survey_or_department()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var wrongSurvey = await client.PostAsJsonAsync(
            "/admin/ai-insights", CreateRequest(_companyAId, surveyId: _surveyBId));
        Assert.Equal(HttpStatusCode.BadRequest, wrongSurvey.StatusCode);

        var wrongDepartment = await client.PostAsJsonAsync(
            "/admin/ai-insights", CreateRequest(_companyAId, departmentId: _departmentBId));
        Assert.Equal(HttpStatusCode.BadRequest, wrongDepartment.StatusCode);

        // Neither attempt may have been persisted.
        var list = (await (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AIInsightListItem>>())!;
        Assert.Empty(list);
    }

    [Fact]
    public async Task Unknown_ids_are_400_on_create_and_404_on_read()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var unknownCompany = await superAdmin.PostAsJsonAsync("/admin/ai-insights", CreateRequest(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.BadRequest, unknownCompany.StatusCode);

        var unknownSurvey = await superAdmin.PostAsJsonAsync(
            "/admin/ai-insights", CreateRequest(_companyAId, surveyId: Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.BadRequest, unknownSurvey.StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await superAdmin.GetAsync($"/admin/ai-insights/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await superAdmin.PostAsync($"/admin/ai-insights/{Guid.NewGuid()}/acknowledge", null)).StatusCode);
    }

    [Theory]
    [InlineData("", "engagement", "Title", "Description", 50, "high")]
    [InlineData("trend", "", "Title", "Description", 50, "high")]
    [InlineData("trend", "engagement", "   ", "Description", 50, "high")]
    [InlineData("trend", "engagement", "Title", "", 50, "high")]
    [InlineData("trend", "engagement", "Title", "Description", 50, "")]
    [InlineData("trend", "engagement", "Title", "Description", 101, "high")]
    [InlineData("trend", "engagement", "Title", "Description", -1, "high")]
    public async Task A_malformed_insight_is_a_400_not_a_500(
        string type, string category, string title, string description, int confidenceScore, string priority)
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.PostAsJsonAsync("/admin/ai-insights", CreateRequest(
            _companyAId, title: title, type: type, category: category,
            description: description, confidenceScore: confidenceScore, priority: priority));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_over_long_field_is_a_400_rather_than_a_Postgres_22001()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.PostAsJsonAsync("/admin/ai-insights", CreateRequest(
            _companyAId, description: new string('x', AIInsightValidation.MaxDescriptionLength + 1)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Blank_array_entries_are_dropped_rather_than_stored_as_empty_strings()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var created = await CreateInsightAsync(client, CreateRequest(
            _companyAId, affectedSegments: ["Sales", "   ", ""], recommendedActions: [" Schedule 1:1s "]));

        Assert.Equal(new[] { "Sales" }, created.AffectedSegments);
        Assert.Equal(new[] { "Schedule 1:1s" }, created.RecommendedActions);
    }

    [Fact]
    public async Task A_SuperAdmin_may_cross_companies()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var inA = await CreateInsightAsync(superAdmin, CreateRequest(_companyAId, "A"));
        var inB = await CreateInsightAsync(superAdmin, CreateRequest(_companyBId, "B"));

        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/admin/ai-insights/{inA.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/admin/ai-insights/{inB.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/admin/ai-insights?companyId={_companyBId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await superAdmin.PostAsync($"/admin/ai-insights/{inB.Id}/acknowledge", null)).StatusCode);
    }

    [Theory]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task A_non_admin_of_the_same_company_is_denied(string role)
    {
        // CanAccessCompany is an allow-list of two roles, so a leader in the right company is
        // still not an insight reader. Worth pinning: a bare "is this my company" check would
        // have let all three through, and these findings name departments and segments.
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var insight = await CreateInsightAsync(superAdmin, CreateRequest(_companyAId, "Restricted"));

        var member = await ClientAsync(role, _companyADomain, _companyAId);

        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/admin/ai-insights/{insight.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await member.PostAsync($"/admin/ai-insights/{insight.Id}/acknowledge", null)).StatusCode);

        var createResponse = await member.PostAsJsonAsync("/admin/ai-insights", CreateRequest(_companyAId, "Nope"));
        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_is_unauthorized()
    {
        var client = _factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.GetAsync($"/admin/ai-insights?companyId={_companyAId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsync($"/admin/ai-insights/{Guid.NewGuid()}/acknowledge", null)).StatusCode);
    }
}
