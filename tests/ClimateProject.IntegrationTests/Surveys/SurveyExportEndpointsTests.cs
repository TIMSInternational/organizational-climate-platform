using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// <c>GET /surveys/{id}/export</c>, <c>/export/csv</c> and <c>/export/pdf</c> through the real
/// pipeline (#122).
///
/// <para>
/// The projection is proved without Docker in <c>SurveyExportTests</c> -- it is a pure function
/// over a <see cref="SurveyAggregate"/>. What genuinely needs Postgres, and is therefore what
/// lives here, is everything that class structurally cannot reach: that the floor still holds
/// when the responses come out of the real jsonb columns rather than a fixture, that another
/// tenant's admin cannot download the file at all, and that the download leaves a row in
/// <c>audit_logs</c> saying who took a copy.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SurveyExportEndpointsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _engineeringId;
    private Guid _directionId;

    public SurveyExportEndpointsTests(PostgresContainerFixture postgres)
    {
        _postgres = postgres;
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"exp-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyAId = await _harness.SeedCompanyAsync("Export Co A");
        _companyBId = await _harness.SeedCompanyAsync("Export Co B");
        _engineeringId = await _harness.SeedDepartmentAsync(_companyAId, "Ingeniería");
        _directionId = await _harness.SeedDepartmentAsync(_companyAId, "Dirección");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ==================================================================
    // The two formats exist and are the formats they claim to be
    // ==================================================================

    [Fact]
    public async Task The_csv_route_returns_a_csv_file_with_the_survey_in_it()
    {
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var client = await AdminAAsync();

        var response = await client.GetAsync($"/surveys/{survey.Id}/export/csv");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(SurveyExport.CsvFileName(survey.Id), response.Content.Headers.ContentDisposition?.FileNameStar);

        var bytes = await response.Content.ReadAsByteArrayAsync();

        // The BOM, because without it Excel renders every accented character in a
        // Spanish-language export as mojibake -- and this is the artefact an admin forwards.
        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);

        var rows = Rows(bytes);
        Assert.Equal(survey.Id.ToString(), Summary(rows, "survey_id"));
        Assert.Equal("6", Summary(rows, "completed_count"));

        // Through the real jsonb column: the option value the responses were stored with is
        // the group key that comes back.
        var remote = rows.Single(r => r.Section == SurveyExport.OptionSection && r.Group == "remote" && r.Metric == "count");
        Assert.Equal("6", remote.Value);
    }

    [Fact]
    public async Task The_pdf_route_returns_a_pdf_a_reader_can_open()
    {
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var client = await AdminAAsync();

        var response = await client.GetAsync($"/surveys/{survey.Id}/export/pdf");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(SurveyExport.PdfFileName(survey.Id), response.Content.Headers.ContentDisposition?.FileNameStar);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        var text = Encoding.Latin1.GetString(bytes);

        // Header, page tree and a cross-reference table that ends the file. A PDF without a
        // usable trailer opens in nothing, however correct the text inside it is.
        Assert.StartsWith("%PDF-1.", text, StringComparison.Ordinal);
        Assert.Contains("/Type /Catalog", text, StringComparison.Ordinal);
        Assert.Contains("startxref", text, StringComparison.Ordinal);
        Assert.EndsWith("%%EOF\n", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_legacy_export_route_serves_csv_by_default_and_pdf_on_request()
    {
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var client = await AdminAAsync();

        var bare = await client.GetAsync($"/surveys/{survey.Id}/export");
        Assert.Equal("text/csv", bare.Content.Headers.ContentType?.MediaType);

        var pdf = await client.GetAsync($"/surveys/{survey.Id}/export?format=PDF");
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);

        // An unknown format is refused rather than silently served as a spreadsheet. A caller
        // who asked for xlsx and got CSV named .csv would notice; one who got CSV named
        // whatever they asked for would not.
        var unknown = await client.GetAsync($"/surveys/{survey.Id}/export?format=xlsx");
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
    }

    // ==================================================================
    // THE PROPERTY THIS SLICE OWNS: the file cannot show what the screen withholds
    // ==================================================================

    /// <summary>
    /// Four complete responses through the real pipeline: <c>/results</c> withholds the
    /// distribution, and so must both files.
    /// </summary>
    /// <remarks>
    /// Asserted against <c>/results</c> rather than against a written-down expectation, because
    /// the requirement is not "the export suppresses" but "the export and the screen suppress
    /// the same thing". A copy of the rule here would go green the day the two diverged.
    /// </remarks>
    [Fact]
    public async Task Below_the_floor_neither_file_carries_what_the_results_screen_withholds()
    {
        var survey = await SeedSurveyAsync(completedResponses: SurveyResultsPrivacy.MinimumRespondents - 1);
        var client = await AdminAAsync();

        var screen = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results");
        Assert.True(screen!.IsSuppressed);
        Assert.Empty(screen.Questions);

        var rows = Rows(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv"));
        Assert.Equal("true", Summary(rows, "is_suppressed"));
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.OptionSection);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.QuestionSection);

        // And the option value the four people actually chose appears nowhere in the file --
        // not as a bucket, not as a label, not as a word.
        var text = Encoding.UTF8.GetString(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv"));
        Assert.DoesNotContain("remote", text, StringComparison.Ordinal);

        var pdf = Encoding.Latin1.GetString(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/pdf"));
        Assert.DoesNotContain("remote", pdf, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Remoto", pdf, StringComparison.Ordinal);
    }

    /// <summary>
    /// A survey that clears its own floor while one department does not. The department is the
    /// re-identification surface, and an export is where it gets sliced below the floor by
    /// accident.
    /// </summary>
    [Fact]
    public async Task A_department_below_the_segment_floor_contributes_no_answers_to_the_file()
    {
        // Six in Ingeniería, three in Dirección: the survey is well above its own floor and one
        // segment is below the segment floor.
        var survey = await SeedSurveyAsync(
            completedResponses: 0,
            byDepartment: [(_engineeringId, 6), (_directionId, 3)]);

        var client = await AdminAAsync();
        var rows = Rows(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv"));

        Assert.Equal("false", Summary(rows, "is_suppressed"));

        var engineering = $"department:{_engineeringId}";
        var direction = $"department:{_directionId}";

        Assert.Equal("false", SegmentMetric(rows, engineering, "is_suppressed"));
        Assert.Equal("6", SegmentMetric(rows, engineering, "respondent_count"));
        Assert.Contains(rows, r => r.Section == SurveyExport.SegmentQuestionSection && r.Group == engineering);

        // The withheld department contributes no row, in either section.
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.SegmentSection && r.Group == direction);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.SegmentQuestionSection && r.Group == direction);

        // Counted, so a reader can tell a withheld group from an absent one.
        var breakdown = rows.Where(r => r.Section == SurveyExport.BreakdownSection && r.Group == "department").ToList();
        Assert.Equal("1", breakdown.Single(r => r.Metric == "suppressed_segment_count").Value);
        Assert.Equal("3", breakdown.Single(r => r.Metric == "suppressed_respondent_count").Value);

        // And its NAME is in neither file. The department name reaches the aggregate on a
        // suppressed segment -- SurveyAggregation keeps it -- so this is a property of the
        // exporters, not of the data they are handed.
        var csv = Encoding.UTF8.GetString(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv"));
        Assert.Contains("Ingeniería", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("Dirección", csv, StringComparison.Ordinal);

        var pdf = Encoding.Latin1.GetString(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/pdf"));
        Assert.Contains(@"Ingenier\355a", pdf, StringComparison.Ordinal);
        Assert.DoesNotContain(@"Direcci\363n", pdf, StringComparison.Ordinal);
    }

    /// <summary>
    /// The demographic breakdown, through the real <c>response_demographics</c> jsonb column.
    /// </summary>
    /// <remarks>
    /// <see cref="SurveyResultsPrivacy"/> calls this the real disclosure surface, and it behaves
    /// unlike the department path in the way that matters here: a demographic segment carries no
    /// label, so its KEY is the value the respondent supplied. A withheld group would be named
    /// by the group column itself -- <c>nationality:Venezolana</c> -- rather than by a field an
    /// exporter could choose not to print.
    ///
    /// <para>
    /// Neither export test file reached this branch before: both seeded departments only, so
    /// every proof of the anonymity criterion landed on the path whose key is a GUID.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task A_demographic_group_below_the_floor_is_named_in_neither_file()
    {
        var survey = await SeedSurveyAsync(
            completedResponses: 0,
            byDemographic: [("nationality", "Costarricense", 6), ("nationality", "Venezolana", 2)]);

        var client = await AdminAAsync();
        var rows = Rows(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv"));

        Assert.Equal("false", Summary(rows, "is_suppressed"));
        Assert.Equal("6", SegmentMetric(rows, "nationality:Costarricense", "respondent_count"));

        Assert.DoesNotContain(rows, r => r.Group.Contains("Venezolana", StringComparison.Ordinal));

        var breakdown = rows.Where(r => r.Section == SurveyExport.BreakdownSection && r.Group == "nationality").ToList();
        Assert.Equal("1", breakdown.Single(r => r.Metric == "suppressed_segment_count").Value);
        Assert.Equal("2", breakdown.Single(r => r.Metric == "suppressed_respondent_count").Value);

        var csv = Encoding.UTF8.GetString(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv"));
        Assert.Contains("Costarricense", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("Venezolana", csv, StringComparison.Ordinal);

        var pdf = Encoding.Latin1.GetString(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/pdf"));
        Assert.Contains("Costarricense", pdf, StringComparison.Ordinal);
        Assert.DoesNotContain("Venezolana", pdf, StringComparison.Ordinal);
    }

    // ==================================================================
    // The locale the reader asked for
    // ==================================================================

    /// <summary>
    /// <c>?lang=</c> reaches the document, not just the handler signature.
    /// </summary>
    /// <remarks>
    /// The web client sends <c>?lang=&lt;locale&gt;</c> on every PDF download
    /// (<c>web/src/features/surveys/api/surveyExport.ts</c>) and asserts the URL it built. The
    /// server end was untested: no integration test sent the parameter at all, and the unit
    /// tests construct a <c>SurveyExportContext</c> directly, so they start downstream of the
    /// wire that carries it. Dropping <c>lang</c> on the way into the loader left every suite
    /// green while handing a Spanish admin an English document.
    ///
    /// <para>
    /// This survey is bilingual, so nothing but the parameter decides the answer: with
    /// <c>ContentLanguages.Both</c> there is no single content locale to fall back to and the
    /// default is English.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task The_requested_locale_reaches_both_documents()
    {
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var client = await AdminAAsync();

        var spanishRows = Rows(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv?lang=es"));
        var englishRows = Rows(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv?lang=en"));

        Assert.Equal(ContentLanguages.Spanish, Summary(spanishRows, "resolved_locale"));
        Assert.Equal(ContentLanguages.English, Summary(englishRows, "resolved_locale"));

        // The resolved title follows it, so this is the content and not only a label.
        Assert.Equal("Clima Q3", Summary(spanishRows, "title"));
        Assert.Equal("Q3 Climate", Summary(englishRows, "title"));

        // And the PDF chrome, which is what an admin forwards to a director.
        var spanishPdf = Encoding.Latin1.GetString(
            await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/pdf?lang=es"));
        var englishPdf = Encoding.Latin1.GetString(
            await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/pdf?lang=en"));

        Assert.Contains(@"Participaci\363n", spanishPdf, StringComparison.Ordinal);
        Assert.DoesNotContain(@"Participaci\363n", englishPdf, StringComparison.Ordinal);
        Assert.Contains("Participation", englishPdf, StringComparison.Ordinal);

        // The legacy route carries it too -- it is the one the old surface's links point at.
        var legacy = Rows(await client.GetByteArrayAsync($"/surveys/{survey.Id}/export?format=csv&lang=es"));
        Assert.Equal(ContentLanguages.Spanish, Summary(legacy, "resolved_locale"));
    }

    // ==================================================================
    // Who may take a copy
    // ==================================================================

    [Fact]
    public async Task Another_tenants_admin_cannot_export()
    {
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var intruder = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);

        Assert.Equal(HttpStatusCode.Forbidden, (await intruder.GetAsync($"/surveys/{survey.Id}/export/csv")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await intruder.GetAsync($"/surveys/{survey.Id}/export/pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await intruder.GetAsync($"/surveys/{survey.Id}/export")).StatusCode);
    }

    [Fact]
    public async Task An_employee_of_the_owning_company_cannot_export()
    {
        // The results routes are admin-only; a file is a stronger form of the same read, so it
        // cannot be a weaker check. An employee downloading their own department's numbers is
        // the leak the whole disclosure model is built around.
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var employee = await _harness.ClientAsync(Roles.Employee, _companyAId, _engineeringId);

        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync($"/surveys/{survey.Id}/export/csv")).StatusCode);
    }

    [Fact]
    public async Task An_unknown_survey_is_a_404_and_an_anonymous_caller_a_401()
    {
        var client = await AdminAAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/surveys/{Guid.NewGuid()}/export/csv")).StatusCode);

        var survey = await SeedSurveyAsync(completedResponses: 6);
        var anonymous = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/surveys/{survey.Id}/export/pdf")).StatusCode);
    }

    // ==================================================================
    // Audit
    // ==================================================================

    /// <summary>
    /// "Who exported this data" is one of the three questions #143 says the trail exists to
    /// answer.
    /// </summary>
    /// <remarks>
    /// The verb is <see cref="AuditVerbs.Export"/> and not <see cref="AuditVerbs.Read"/>: a
    /// read leaves the data on the server and an export hands the caller a copy to keep, and
    /// only the verb lets the two be told apart when the trail is queried after an incident.
    /// </remarks>
    [Fact]
    public async Task Every_export_is_audited_under_the_export_verb()
    {
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var (client, userId) = await AdminWithIdAsync();

        // A read of the same survey through an UNMARKED route first. It must leave nothing, so
        // the rows counted below are the exports and not the traffic around them.
        await client.GetAsync($"/surveys/{survey.Id}/statistics");
        Assert.Empty(await AuditRowsAsync(userId));

        await client.GetAsync($"/surveys/{survey.Id}/export/csv");
        await client.GetAsync($"/surveys/{survey.Id}/export/pdf");
        await client.GetAsync($"/surveys/{survey.Id}/export?format=csv");

        var rows = await AuditRowsAsync(userId);
        Assert.Equal(3, rows.Count);
        Assert.All(rows, row => Assert.True(row.Success));
        Assert.All(rows, row => Assert.EndsWith($".{AuditVerbs.Export}", row.Action, StringComparison.Ordinal));

        Assert.Equal(
            ["surveys.export.csv.export", "surveys.export.export", "surveys.export.pdf.export"],
            rows.Select(r => r.Action).Order(StringComparer.Ordinal));

        // The SCOPE half of #122's "audit-logged with actor and scope". Without it the trail
        // answers "somebody exported a survey" and not "somebody exported THIS survey", which
        // is the only version of the answer worth having after an incident. It is derived by
        // the middleware from the route's Guid rather than set by the handler -- which is
        // exactly why it needs asserting here: nothing in SurveyExportEndpoints would look
        // wrong if the derivation stopped working.
        Assert.All(rows, row => Assert.Equal(survey.Id.ToString(), row.ResourceId));
        Assert.All(rows, row => Assert.Equal(_companyAId, row.CompanyId));
    }

    [Fact]
    public async Task A_refused_export_is_audited_too()
    {
        // The attempts are exactly what a security trail wants, and a 403 that left no trace
        // would make "who tried to take a copy of another tenant's survey" unanswerable.
        var survey = await SeedSurveyAsync(completedResponses: 6);
        var (intruder, intruderId) = await AdminWithIdAsync(_companyBId);

        Assert.Equal(HttpStatusCode.Forbidden, (await intruder.GetAsync($"/surveys/{survey.Id}/export/csv")).StatusCode);

        var row = Assert.Single(await AuditRowsAsync(intruderId));
        Assert.Equal("surveys.export.csv.export", row.Action);
        Assert.False(row.Success);
        Assert.Equal("HTTP 403", row.ErrorMessage);
    }

    // ==================================================================
    // Size
    // ==================================================================

    /// <summary>
    /// A survey big enough that a buffered writer would hold the whole document.
    /// </summary>
    /// <remarks>
    /// This is not a memory measurement -- a heap assertion in a shared test host measures the
    /// suite, not the export. What it does prove is the part a unit test cannot: that the
    /// streaming path survives contact with Kestrel end to end, and that a file large enough to
    /// span many buffer flushes arrives complete, with its last row intact. A response
    /// truncated at a buffer boundary is the characteristic failure of a streamed download, and
    /// it is invisible to any test that only reads the first rows.
    /// </remarks>
    [Fact]
    public async Task A_large_export_arrives_complete()
    {
        var survey = await SeedSurveyAsync(completedResponses: 250, questionCount: 12);
        var client = await AdminAAsync();

        var bytes = await client.GetByteArrayAsync($"/surveys/{survey.Id}/export/csv");
        var rows = Rows(bytes);

        Assert.True(bytes.Length > 8192, $"the fixture was too small to cross a buffer boundary: {bytes.Length} bytes");
        Assert.Equal("250", Summary(rows, "completed_count"));

        Assert.Equal(12, rows.Count(r => r.Section == SurveyExport.QuestionSection && r.Metric == "text"));
        Assert.Equal(SurveyExport.SummarySection, rows[0].Section);

        // THE tail. The section order is summary, language, question, dimension, breakdown, so
        // the last row written is the department breakdown's unsegmented count -- and with 250
        // department-less responses it is 250, a value no earlier row carries.
        //
        // The assertions above are the head and the middle. A response truncated on a CRLF
        // boundary anywhere after the question section leaves every remaining line well formed,
        // so the parser succeeds and all of them pass: exactly the streamed-download failure
        // this test is named for, invisible to the test that named it.
        var last = rows[^1];
        Assert.Equal(SurveyExport.BreakdownSection, last.Section);
        Assert.Equal("unsegmented_respondent_count", last.Metric);
        Assert.Equal("250", last.Value);
    }

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    private Task<HttpClient> AdminAAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

    private async Task<(HttpClient Client, Guid UserId)> AdminWithIdAsync(Guid? companyId = null)
    {
        var company = companyId ?? _companyAId;
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, company);

        // The most recently created user of that company is the one the client above
        // authenticates as -- TokenAsync signs up a fresh user per call.
        var userId = await _harness.WithDbAsync(async db => (await db.Users
            .Where(u => u.CompanyId == company)
            .OrderByDescending(u => u.CreatedAt)
            .FirstAsync()).Id);

        return (client, userId);
    }

    private async Task<List<AuditLog>> AuditRowsAsync(Guid userId)
    {
        await using var db = new ClimateProjectDbContext(
            new DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(_postgres.ConnectionString).Options);

        return await db.AuditLogs.AsNoTracking().Where(a => a.UserId == userId).ToListAsync();
    }

    /// <summary>
    /// A bilingual survey with <paramref name="questionCount"/> choice questions, and completed
    /// responses that all pick "remote".
    /// </summary>
    /// <param name="byDepartment">
    /// Additional responses tagged to a department. Written straight to the table because
    /// <c>SurveyResponsePrivacy</c> decides the department at write time in the real submit
    /// path, and this fixture is about what the AGGREGATION does with a department that is
    /// already on the row.
    /// </param>
    /// <param name="byDemographic">
    /// Additional responses carrying a demographic answer, written to
    /// <c>response_demographics</c> the way the submit path writes it -- the value
    /// JSON-encoded, because the column is jsonb and the aggregation decodes it back.
    /// </param>
    private async Task<SurveyDetail> SeedSurveyAsync(
        int completedResponses,
        int questionCount = 1,
        IReadOnlyList<(Guid DepartmentId, int Count)>? byDepartment = null,
        IReadOnlyList<(string Field, string Value, int Count)>? byDemographic = null)
    {
        var client = await AdminAAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId,
            title: SurveyTestHarness.Both("Q3 Climate", "Clima Q3"),
            language: ContentLanguages.Both,
            questions:
            [
                .. Enumerable.Range(0, questionCount).Select(i => new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both($"Where do you work? ({i})", $"¿Dónde trabajas? ({i})"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("remote", SurveyTestHarness.Both("Remote", "Remoto")),
                        new CreateSurveyQuestionOptionInput("office", SurveyTestHarness.Both("Office", "Oficina")),
                    ],
                    Order: i)),
            ]));

        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var questionIds = survey.Questions.Select(q => q.Id).ToList();

        for (var i = 0; i < completedResponses; i++)
        {
            await SeedResponseAsync(survey.Id, questionIds, null);
        }

        foreach (var (departmentId, count) in byDepartment ?? [])
        {
            for (var i = 0; i < count; i++)
            {
                await SeedResponseAsync(survey.Id, questionIds, departmentId);
            }
        }

        foreach (var (field, value, count) in byDemographic ?? [])
        {
            for (var i = 0; i < count; i++)
            {
                await SeedResponseAsync(survey.Id, questionIds, null, (field, value));
            }
        }

        return survey;
    }

    private Task SeedResponseAsync(
        Guid surveyId,
        IReadOnlyList<Guid> questionIds,
        Guid? departmentId,
        (string Field, string Value)? demographic = null)
        => _harness.WithDbAsync(async db =>
        {
            var responseId = Guid.NewGuid();
            db.Responses.Add(new Response
            {
                Id = responseId,
                SurveyId = surveyId,
                CompanyId = _companyAId,
                UserId = null,
                DepartmentId = departmentId,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = ContentLanguages.Spanish,
                IsComplete = true,
                IsAnonymous = true,
                StartTime = DateTimeOffset.UtcNow.AddMinutes(-5),
                CompletionTime = DateTimeOffset.UtcNow,
                TotalTimeSeconds = 300,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });

            foreach (var questionId in questionIds)
            {
                // response_value is jsonb: a bare `remote` is not valid JSON and Postgres
                // rejects it with 22P02.
                db.QuestionResponses.Add(new QuestionResponse
                {
                    ResponseId = responseId,
                    QuestionId = questionId,
                    ResponseValue = JsonSerializer.Serialize("remote"),
                    ResponseText = null,
                });
            }

            if (demographic is { } answered)
            {
                // Serialized exactly as SurveyResponseEndpoints stores it. The aggregation
                // decodes the payload before grouping, so a bare string here would group on
                // text no producer writes and would still pass -- the decoder tolerates it.
                db.ResponseDemographics.Add(new ResponseDemographic
                {
                    ResponseId = responseId,
                    Field = answered.Field,
                    Value = JsonSerializer.Serialize(answered.Value),
                });
            }

            await db.SaveChangesAsync();
        });

    // ------------------------------------------------------------------
    // Reading the file back
    // ------------------------------------------------------------------

    private sealed record CsvRow(string Section, string Question, string Group, string Language, string Metric, string Value);

    private static IReadOnlyList<CsvRow> Rows(byte[] bytes)
    {
        var text = Encoding.UTF8.GetString(bytes.AsSpan(3));

        return
        [
            .. text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries)
                .Skip(1)
                .Select(line =>
                {
                    var fields = line[1..^1].Split("\",\"", StringSplitOptions.None);
                    return new CsvRow(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]);
                }),
        ];
    }

    private static string Summary(IReadOnlyList<CsvRow> rows, string key)
        => rows.Single(r => r.Section == SurveyExport.SummarySection && r.Group == key).Value;

    private static string SegmentMetric(IReadOnlyList<CsvRow> rows, string key, string metric)
        => rows.Single(r => r.Section == SurveyExport.SegmentSection && r.Group == key && r.Metric == metric).Value;
}
