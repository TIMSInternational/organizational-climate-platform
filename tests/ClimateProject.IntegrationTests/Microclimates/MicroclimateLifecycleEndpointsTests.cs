using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

/// <summary>
/// #131: activate, status, export, insights, bulk, and template instantiation.
/// </summary>
[Collection("Postgres")]
public class MicroclimateLifecycleEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"mcla-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"mclb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public MicroclimateLifecycleEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "MCL Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "MCL Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private async Task<HttpClient> AdminClientAsync(Guid companyId, string domain)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, domain, companyId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<MicroclimateDetail> CreateAsync(
        HttpClient client,
        Guid companyId,
        string title = "Weekly pulse",
        List<CreateQuestionInput>? questions = null)
    {
        var response = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: title,
            Description: null,
            CompanyId: companyId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 40,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: questions));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<MicroclimateDetail>())!;
    }

    // ------------------------------------------------------------------
    // Activate + status transitions
    // ------------------------------------------------------------------

    [Fact]
    public async Task Activate_moves_a_draft_to_active()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);

        var response = await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var activated = await response.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal(MicroclimateStatuses.Active, activated!.Status);
    }

    [Fact]
    public async Task Activating_an_already_active_microclimate_is_an_idempotent_no_op()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);
        await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        var again = await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var detail = await again.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal(MicroclimateStatuses.Active, detail!.Status);
    }

    [Fact]
    public async Task A_closed_microclimate_cannot_be_reopened()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);
        await client.PostAsync($"/microclimates/{created.Id}/activate", null);
        await client.PutAsJsonAsync(
            $"/microclimates/{created.Id}/status",
            new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Closed));

        var reopen = await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        Assert.Equal(HttpStatusCode.Conflict, reopen.StatusCode);
    }

    [Fact]
    public async Task An_active_microclimate_cannot_be_sent_back_to_draft()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);
        await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        var response = await client.PutAsJsonAsync(
            $"/microclimates/{created.Id}/status",
            new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Draft));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task The_status_field_on_the_update_route_enforces_the_same_transitions()
    {
        // The regression this issue exists to fix. Before #131 PUT /microclimates/{id}
        // checked only that the string was a member of the vocabulary, so this exact call
        // walked a closed microclimate back to active -- past a lifecycle that PUT /status
        // would have refused.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);
        await client.PostAsync($"/microclimates/{created.Id}/activate", null);
        await client.PutAsJsonAsync(
            $"/microclimates/{created.Id}/status",
            new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Closed));

        var response = await client.PutAsJsonAsync(
            $"/microclimates/{created.Id}",
            new UpdateMicroclimateRequest(null, null, MicroclimateStatuses.Active, null));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        var after = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{created.Id}");
        Assert.Equal(MicroclimateStatuses.Closed, after!.Status);
    }

    [Fact]
    public async Task An_unknown_status_is_rejected_as_a_bad_request_not_a_conflict()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);

        var response = await client.PutAsJsonAsync(
            $"/microclimates/{created.Id}/status",
            new UpdateMicroclimateStatusRequest("archived"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_abandoned_draft_can_be_closed_without_a_complete_set_of_translations()
    {
        // draft -> closed is not a publish: nothing goes in front of a respondent, so the
        // translation gate must not block throwing the draft away.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Half translated" }),
            Description: null,
            CompanyId: _companyAId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 5,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: null,
            Timezone: null,
            Language: "both"));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        // Sanity: this content genuinely cannot publish.
        var publish = await client.PostAsync($"/microclimates/{created!.Id}/activate", null);
        Assert.Equal(HttpStatusCode.BadRequest, publish.StatusCode);

        var close = await client.PutAsJsonAsync(
            $"/microclimates/{created.Id}/status",
            new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Closed));

        Assert.Equal(HttpStatusCode.OK, close.StatusCode);
    }

    [Fact]
    public async Task An_employee_cannot_activate_their_own_companys_microclimate()
    {
        var admin = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(admin, _companyAId);

        var employee = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(employee, Roles.Employee, _companyADomain, _companyAId);
        employee.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await employee.PostAsync($"/microclimates/{created.Id}/activate", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_admin_cannot_activate_another_companys_microclimate()
    {
        var adminB = await AdminClientAsync(_companyBId, _companyBDomain);
        var created = await CreateAsync(adminB, _companyBId);

        var adminA = await AdminClientAsync(_companyAId, _companyADomain);
        var response = await adminA.PostAsync($"/microclimates/{created.Id}/activate", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // Every route that funnels through LoadForAdminAsync. The helper is one guard, one
    // condition -- MicroclimateEndpoints.CanAccessCompany -- and these two tests are what
    // hold it. Listed as data rather than as five tests so that a sixth route added to the
    // helper is one line here, and so that the day the guard is weakened the failure names
    // every surface it opened rather than one of them.
    public static TheoryData<string> AdminOnlyRoutes => new()
    {
        "activate",
        "status",
        "export",
        "export/csv",
        "insights",
    };

    private static Task<HttpResponseMessage> CallAsync(HttpClient client, Guid id, string route)
        => route switch
        {
            "activate" => client.PostAsync($"/microclimates/{id}/activate", null),
            "status" => client.PutAsJsonAsync(
                $"/microclimates/{id}/status",
                new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Closed)),
            _ => client.GetAsync($"/microclimates/{id}/{route}"),
        };

    [Theory]
    [MemberData(nameof(AdminOnlyRoutes))]
    public async Task An_employee_of_the_owning_company_is_refused_every_admin_route(string route)
    {
        // The regression CanAccessCompany's own comment records: weakened to a bare CompanyId
        // match, it let any authenticated employee of the company rewrite a microclimate and
        // flip its status. That weakening used to be invisible here, because LoadForAdminAsync
        // repeated the role test in a second condition and caught the employee the mutation
        // let through. The duplicate is gone, so this is now the test that fails.
        var admin = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(admin, _companyAId);

        var employee = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(employee, Roles.Employee, _companyADomain, _companyAId);
        employee.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await CallAsync(employee, created.Id, route);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AdminOnlyRoutes))]
    public async Task An_admin_of_another_company_is_refused_every_admin_route(string route)
    {
        var adminB = await AdminClientAsync(_companyBId, _companyBDomain);
        var theirs = await CreateAsync(adminB, _companyBId);

        var adminA = await AdminClientAsync(_companyAId, _companyADomain);
        var response = await CallAsync(adminA, theirs.Id, route);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Bulk
    // ------------------------------------------------------------------

    [Fact]
    public async Task Bulk_close_closes_every_microclimate_the_caller_owns()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var first = await CreateAsync(client, _companyAId, "First");
        var second = await CreateAsync(client, _companyAId, "Second");

        var response = await client.PostAsJsonAsync(
            "/microclimates/bulk",
            new BulkMicroclimateActionRequest("close", [first.Id, second.Id]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<BulkMicroclimateActionResponse>();
        Assert.All(body!.Results, r => Assert.True(r.Succeeded));

        var after = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{first.Id}");
        Assert.Equal(MicroclimateStatuses.Closed, after!.Status);
    }

    [Fact]
    public async Task Bulk_reports_another_tenants_row_as_not_found_rather_than_forbidden()
    {
        var adminB = await AdminClientAsync(_companyBId, _companyBDomain);
        var theirs = await CreateAsync(adminB, _companyBId, "B's pulse");

        var adminA = await AdminClientAsync(_companyAId, _companyADomain);
        var response = await adminA.PostAsJsonAsync(
            "/microclimates/bulk",
            new BulkMicroclimateActionRequest("close", [theirs.Id]));

        var body = await response.Content.ReadFromJsonAsync<BulkMicroclimateActionResponse>();
        var result = Assert.Single(body!.Results);
        Assert.False(result.Succeeded);

        // "Not found", never "forbidden": an endpoint that takes a list of ids and answers
        // one-by-one is the ideal shape for a cross-tenant existence probe.
        Assert.Equal("Microclimate not found", result.Message);

        // And it really is untouched.
        var after = await adminB.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{theirs.Id}");
        Assert.Equal(MicroclimateStatuses.Draft, after!.Status);
    }

    [Fact]
    public async Task Bulk_is_a_loop_never_a_bypass_of_the_transition_map()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var closed = await CreateAsync(client, _companyAId, "Already closed");
        await client.PutAsJsonAsync(
            $"/microclimates/{closed.Id}/status",
            new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Closed));

        var response = await client.PostAsJsonAsync(
            "/microclimates/bulk",
            new BulkMicroclimateActionRequest("activate", [closed.Id]));

        var body = await response.Content.ReadFromJsonAsync<BulkMicroclimateActionResponse>();
        Assert.False(Assert.Single(body!.Results).Succeeded);

        var after = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{closed.Id}");
        Assert.Equal(MicroclimateStatuses.Closed, after!.Status);
    }

    [Fact]
    public async Task A_bulk_item_reports_the_reason_it_actually_failed_not_the_transition()
    {
        // draft -> active IS a legal transition, so "cannot move from draft to active" would
        // be a lie. What stopped this row is the translation gate, and that is what the admin
        // has to be told or they go looking at the status field.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Half translated" }),
            Description: null,
            CompanyId: _companyAId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 5,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: null,
            Timezone: null,
            Language: "both"));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var response = await client.PostAsJsonAsync(
            "/microclimates/bulk",
            new BulkMicroclimateActionRequest("activate", [created!.Id]));

        var body = await response.Content.ReadFromJsonAsync<BulkMicroclimateActionResponse>();
        var result = Assert.Single(body!.Results);

        Assert.False(result.Succeeded);
        Assert.DoesNotContain("Cannot move a microclimate", result.Message!, StringComparison.Ordinal);

        // And it is still not activated: the gate refused it, the loop did not bypass it.
        var after = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{created.Id}");
        Assert.Equal(MicroclimateStatuses.Draft, after!.Status);
    }

    [Fact]
    public async Task An_unknown_bulk_action_is_rejected()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);

        var response = await client.PostAsJsonAsync(
            "/microclimates/bulk",
            new BulkMicroclimateActionRequest("delete", [created.Id]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    /// <summary>
    /// Drives enough real submissions through the public route to clear the disclosure
    /// floor. Deliberately not seeded straight into the aggregate: the export has to be
    /// tested against counts the product itself produced.
    /// </summary>
    private static async Task SubmitAsync(HttpClient anonymous, Guid microclimateId, Guid questionId, string text)
    {
        var response = await anonymous.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = text }, "en"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Export_withholds_free_text_from_a_session_below_the_respondent_floor()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(
            client,
            _companyAId,
            questions: [new CreateQuestionInput("What is on your mind?", "open_ended", null, true, 1)]);
        await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        var anonymous = _factory.CreateClient();
        var questionId = created.Questions[0].Id;

        // Two respondents, floor is five.
        await SubmitAsync(anonymous, created.Id, questionId, "visa visa renewal");
        await SubmitAsync(anonymous, created.Id, questionId, "visa renewal");

        var export = await client.GetFromJsonAsync<MicroclimateExport>($"/microclimates/{created.Id}/export");

        Assert.True(export!.IsSuppressed);
        Assert.Empty(export.Words);
        Assert.Equal(SurveyResultsPrivacy.BelowMinimumRespondents, export.SuppressionReason);

        // The counters are never suppressed.
        Assert.Equal(2, export.ResponseCount);
        Assert.Equal(40, export.TargetParticipantCount);
    }

    [Fact]
    public async Task Export_releases_free_text_once_the_session_clears_the_floor()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(
            client,
            _companyAId,
            questions: [new CreateQuestionInput("What is on your mind?", "open_ended", null, true, 1)]);
        await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        var anonymous = _factory.CreateClient();
        var questionId = created.Questions[0].Id;
        for (var i = 0; i < SurveyResultsPrivacy.MinimumRespondents; i++)
        {
            await SubmitAsync(anonymous, created.Id, questionId, "workload workload");
        }

        var export = await client.GetFromJsonAsync<MicroclimateExport>($"/microclimates/{created.Id}/export");

        Assert.False(export!.IsSuppressed);
        Assert.Contains(export.Words, w => w.Text == "workload");
    }

    [Fact]
    public async Task The_csv_export_serves_a_utf8_csv_file()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId, "Pulso semanal");

        var response = await client.GetAsync($"/microclimates/{created.Id}/export/csv");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType!.MediaType);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
        Assert.Contains("Pulso semanal", Encoding.UTF8.GetString(bytes), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_csv_export_applies_the_same_suppression_as_the_json_one()
    {
        // Two routes over one projection. If the floors could be skipped by picking a
        // format, they would not be a control at all.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(
            client,
            _companyAId,
            questions: [new CreateQuestionInput("What is on your mind?", "open_ended", null, true, 1)]);
        await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        var anonymous = _factory.CreateClient();
        await SubmitAsync(anonymous, created.Id, created.Questions[0].Id, "visa renewal");

        var csv = await client.GetStringAsync($"/microclimates/{created.Id}/export/csv");

        Assert.DoesNotContain("visa", csv, StringComparison.Ordinal);
        Assert.Contains("\"is_suppressed\",\"\",\"true\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_export_read_in_a_language_the_content_lacks_labels_the_fields_that_fell_back()
    {
        // Regression: BuildExportAsync collected fallbackFields and then did not pass them to
        // the projection, so every export claimed a complete set of translations. The export
        // is the one artefact that leaves the building, which makes an unlabelled fallback
        // exactly the silent substitution #195 exists to prevent -- a Spanish reader would get
        // the English title with nothing saying so.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId, "Weekly pulse");

        // Authored in English (the company default), read in Spanish.
        var export = await client.GetFromJsonAsync<MicroclimateExport>(
            $"/microclimates/{created.Id}/export?lang=es");

        Assert.Equal("es", export!.ResolvedLocale);
        Assert.Equal("Weekly pulse", export.Title);
        Assert.Contains("title", export.FallbackFields);
    }

    [Fact]
    public async Task The_csv_export_carries_the_fallback_labels_as_rows()
    {
        // The label has to travel in the FILE, not only in the JSON an admin never opens.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId, "Weekly pulse");

        var csv = await client.GetStringAsync($"/microclimates/{created.Id}/export/csv?lang=es");

        Assert.Contains("\"summary\",\"untranslated_field\",\"es\",\"title\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_export_route_serves_a_file_when_the_legacy_format_query_asks_for_one()
    {
        // /export?format=csv is the shape the legacy surface used and the one a client that
        // has not learned /export/csv still sends. It has to produce the FILE, not JSON with
        // a 200 on it -- a caller that asked for a spreadsheet and got a JSON body has no
        // error to report and nothing to open.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId, "Pulso semanal");

        var response = await client.GetAsync($"/microclimates/{created.Id}/export?format=csv");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType!.MediaType);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
        Assert.Contains("\"section\",\"key\",\"language\",\"value\"", Encoding.UTF8.GetString(bytes), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("CSV")]
    [InlineData("Csv")]
    [InlineData("%20csv%20")]
    public async Task The_format_query_is_matched_case_insensitively_and_trimmed(string format)
    {
        // The comparison is OrdinalIgnoreCase over a trimmed value on purpose: this is a
        // hand-typed query string, and the failure mode of getting it wrong is silent --
        // JSON with a 200, not a 400 anyone would notice.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);

        var response = await client.GetAsync($"/microclimates/{created.Id}/export?format={format}");

        Assert.Equal("text/csv", response.Content.Headers.ContentType!.MediaType);
    }

    [Theory]
    [InlineData("")]
    [InlineData("?format=json")]
    [InlineData("?format=pdf")]
    public async Task The_export_route_serves_json_for_anything_that_is_not_csv(string query)
    {
        // Including ?format=pdf. The PDF route was dropped deliberately; an unknown format
        // falls back to the JSON default rather than erroring, which is the documented
        // behaviour and has to stay pinned so the csv branch above cannot be widened into a
        // catch-all by accident.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);

        var response = await client.GetAsync($"/microclimates/{created.Id}/export{query}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task An_admin_cannot_export_another_companys_microclimate()
    {
        var adminB = await AdminClientAsync(_companyBId, _companyBDomain);
        var theirs = await CreateAsync(adminB, _companyBId);

        var adminA = await AdminClientAsync(_companyAId, _companyADomain);

        Assert.Equal(HttpStatusCode.Forbidden, (await adminA.GetAsync($"/microclimates/{theirs.Id}/export")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await adminA.GetAsync($"/microclimates/{theirs.Id}/export/csv")).StatusCode);
    }

    [Fact]
    public async Task An_employee_cannot_export_their_own_companys_microclimate()
    {
        var admin = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(admin, _companyAId);

        var employee = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(employee, Roles.Employee, _companyADomain, _companyAId);
        employee.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await employee.GetAsync($"/microclimates/{created.Id}/export");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_anonymous_visitor_cannot_export()
    {
        var admin = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(admin, _companyAId);

        var anonymous = _factory.CreateClient();
        var response = await anonymous.GetAsync($"/microclimates/{created.Id}/export");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Insights
    // ------------------------------------------------------------------

    [Fact]
    public async Task Insights_reports_that_nothing_has_analysed_the_session_rather_than_returning_an_empty_list()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);

        var insights = await client.GetFromJsonAsync<MicroclimateInsightsResponse>(
            $"/microclimates/{created.Id}/insights");

        Assert.False(insights!.Generated);
        Assert.Equal("no_insight_generator_configured", insights.Reason);
        Assert.Empty(insights.Insights);
    }

    [Fact]
    public async Task Insights_serves_rows_once_something_writes_them()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var created = await CreateAsync(client, _companyAId);

        // Stands in for the generator #67 never produced -- the read side is real and
        // starts working the moment rows exist.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.MicroclimateAiInsights.Add(new MicroclimateAiInsight
            {
                Id = Guid.NewGuid(),
                MicroclimateId = created.Id,
                Type = "theme",
                Message = "Workload is the dominant theme.",
                Confidence = 0.8,
                Timestamp = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var insights = await client.GetFromJsonAsync<MicroclimateInsightsResponse>(
            $"/microclimates/{created.Id}/insights");

        Assert.True(insights!.Generated);
        Assert.Null(insights.Reason);
        Assert.Equal("Workload is the dominant theme.", Assert.Single(insights.Insights).Message);
    }

    [Fact]
    public async Task An_admin_cannot_read_another_companys_insights()
    {
        var adminB = await AdminClientAsync(_companyBId, _companyBDomain);
        var theirs = await CreateAsync(adminB, _companyBId);

        var adminA = await AdminClientAsync(_companyAId, _companyADomain);
        var response = await adminA.GetAsync($"/microclimates/{theirs.Id}/insights");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Template instantiation
    // ------------------------------------------------------------------

    private async Task<Guid> SeedTemplateAsync(Guid? companyId, string name = "Pulse template")
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = "A weekly pulse",
            Category = "pulse",
            CompanyId = companyId,
            IsSystemTemplate = companyId is null,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        template.Settings.DefaultDurationMinutes = 45;
        db.MicroclimateTemplates.Add(template);

        var question = new MicroclimateTemplateQuestion
        {
            Id = Guid.NewGuid(),
            TemplateId = template.Id,
            TextEn = "How is your workload?",
            Type = "multiple_choice",
            Required = true,
            Order = 1,
        };
        db.MicroclimateTemplateQuestions.Add(question);
        db.MicroclimateTemplateQuestionOptions.AddRange(
            new MicroclimateTemplateQuestionOption { MicroclimateTemplateQuestionId = question.Id, Order = 1, Value = "light", LabelEn = "Light" },
            new MicroclimateTemplateQuestionOption { MicroclimateTemplateQuestionId = question.Id, Order = 2, Value = "heavy", LabelEn = "Heavy" });

        await db.SaveChangesAsync();
        return template.Id;
    }

    [Fact]
    public async Task Using_a_template_creates_a_draft_microclimate_carrying_its_questions_and_option_values()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var templateId = await SeedTemplateAsync(_companyAId);

        var response = await client.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<MicroclimateDetail>();

        Assert.Equal(MicroclimateStatuses.Draft, created!.Status);
        Assert.Equal(_companyAId, created.CompanyId);
        Assert.Equal("Pulse template", created.Title);

        var question = Assert.Single(created.Questions);
        Assert.Equal("How is your workload?", question.Text);

        // The stable VALUES are what a submitted answer is validated against and stored as,
        // so carrying them across unchanged is what lets two sessions from one template
        // aggregate together.
        Assert.Equal(["light", "heavy"], question.Options!.OrderBy(o => o.Order).Select(o => o.Value));

        // The template's own duration is what Settings.DefaultDurationMinutes is for.
        Assert.Equal(45, (created.EndTime - created.StartTime).TotalMinutes, 0);
    }

    [Fact]
    public async Task Using_a_template_copies_its_questions_rather_than_referencing_them()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var templateId = await SeedTemplateAsync(_companyAId);

        var response = await client.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest());
        var created = await response.Content.ReadFromJsonAsync<MicroclimateDetail>();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var templateQuestionIds = await db.MicroclimateTemplateQuestions
            .Where(q => q.TemplateId == templateId)
            .Select(q => q.Id)
            .ToListAsync();

        // A fresh row with a fresh id. Editing the template afterwards must never change
        // what a respondent was asked.
        Assert.DoesNotContain(created!.Questions[0].Id, templateQuestionIds);
    }

    [Fact]
    public async Task Using_a_template_counts_the_use()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var templateId = await SeedTemplateAsync(_companyAId);

        await client.PostAsJsonAsync($"/microclimate-templates/{templateId}/use", new UseMicroclimateTemplateRequest());
        await client.PostAsJsonAsync($"/microclimate-templates/{templateId}/use", new UseMicroclimateTemplateRequest());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var template = await db.MicroclimateTemplates.FirstAsync(t => t.Id == templateId);

        Assert.Equal(2, template.UsageCount);
    }

    [Fact]
    public async Task A_global_template_can_be_used_by_any_company()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var templateId = await SeedTemplateAsync(companyId: null, name: "Global pulse");

        var response = await client.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<MicroclimateDetail>();

        // Read access to a global template is the point of one; the microclimate still
        // lands in the caller's own company.
        Assert.Equal(_companyAId, created!.CompanyId);
    }

    [Fact]
    public async Task An_admin_cannot_use_another_companys_template()
    {
        var templateId = await SeedTemplateAsync(_companyBId, "B's template");

        var adminA = await AdminClientAsync(_companyAId, _companyADomain);
        var response = await adminA.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_admin_cannot_instantiate_a_template_into_another_company()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var templateId = await SeedTemplateAsync(companyId: null);

        // Read access to the global template is fine; the WRITE target is not.
        var response = await client.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest(CompanyId: _companyBId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_employee_cannot_use_a_template()
    {
        var templateId = await SeedTemplateAsync(_companyAId);

        var employee = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(employee, Roles.Employee, _companyADomain, _companyAId);
        employee.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await employee.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_retired_template_cannot_seed_new_microclimates()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var templateId = await SeedTemplateAsync(_companyAId);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var template = await db.MicroclimateTemplates.FirstAsync(t => t.Id == templateId);
            template.IsActive = false;
            await db.SaveChangesAsync();
        }

        var response = await client.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
