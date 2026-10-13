using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// A company's reading of a score: "mean" (1,00–5,00, every company's default) or "percent"
/// (0–100, mean × 20). Saved beside the result bands, served with them, and followed by the
/// files a person downloads.
/// </summary>
[Collection("Postgres")]
public class ResultScaleEndpointTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public ResultScaleEndpointTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"scale-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Scale Co");

    public Task DisposeAsync() => Task.CompletedTask;

    private static UpdateCompanySettingsRequest BandsOnly(UpdateResultBandsRequest bands, string? surveyFrequency = null) =>
        new(surveyFrequency, null, null, null, null, null, null, null, null, null, null, null, bands);

    [Fact]
    public async Task A_new_company_reads_on_the_mean()
    {
        var client = await _harness.ClientAsync(Roles.Leader, _companyId);

        var bands = await client.GetFromJsonAsync<ResultBandsDto>($"/admin/companies/{_companyId}/result-bands");

        Assert.Equal("mean", bands!.Scale);
    }

    [Fact]
    public async Task Percent_is_saved_served_and_left_alone_by_a_request_that_does_not_name_it()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var put = await admin.PutAsJsonAsync($"/admin/companies/{_companyId}/settings",
            BandsOnly(new UpdateResultBandsRequest(3.80m, 4.30m, null, null, null, "percent")));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal("percent", (await put.Content.ReadFromJsonAsync<CompanySettingsResponse>())!.ResultBands.Scale);

        var reader = await _harness.ClientAsync(Roles.Leader, _companyId);
        var read = await reader.GetFromJsonAsync<ResultBandsDto>($"/admin/companies/{_companyId}/result-bands");
        // The bands stay on 1–5; only the reading changes.
        Assert.Equal(new ResultBandsDto(3.80m, 4.30m, null, null, null, "percent"), read);

        // A caller written before the scale existed sends no scale, and must not reset it.
        var untouched = await admin.PutAsJsonAsync($"/admin/companies/{_companyId}/settings",
            BandsOnly(new UpdateResultBandsRequest(3.00m, 4.00m, null, null, null)));
        Assert.Equal(HttpStatusCode.OK, untouched.StatusCode);
        Assert.Equal("percent", (await untouched.Content.ReadFromJsonAsync<CompanySettingsResponse>())!.ResultBands.Scale);
    }

    [Theory]
    [InlineData("Percent")]
    [InlineData("0-100")]
    [InlineData("")]
    public async Task An_unknown_scale_is_refused_and_nothing_is_saved(string scale)
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await admin.PutAsJsonAsync($"/admin/companies/{_companyId}/settings",
            BandsOnly(new UpdateResultBandsRequest(3.50m, 4.50m, null, null, null, scale), surveyFrequency: "weekly"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("mean", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var settings = await _harness.WithDbAsync(db => db.Companies.AsNoTracking()
            .Where(c => c.Id == _companyId).Select(c => c.Settings).FirstAsync());
        Assert.Equal("mean", settings.ResultScale);
        Assert.Equal(3.00m, settings.ResultBandOpportunityMin);
        Assert.NotEqual("weekly", settings.SurveyFrequency);
    }

    [Fact]
    public async Task A_survey_csv_for_a_company_on_percent_carries_scores_times_twenty_and_its_scale()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SeedLikertSurveyAsync(admin);

        var before = Rows(await (await admin.GetAsync($"/surveys/{survey.Id}/export/csv")).Content.ReadAsByteArrayAsync());
        Assert.Equal("1-5", Cell(before, SurveyExport.SummarySection, "score_scale", "value"));
        Assert.Equal("4.17", Cell(before, SurveyExport.QuestionSection, survey.Questions[0].Id.ToString(), "average"));

        var put = await admin.PutAsJsonAsync($"/admin/companies/{_companyId}/settings",
            BandsOnly(new UpdateResultBandsRequest(3.00m, 4.00m, null, null, null, "percent")));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var response = await admin.GetAsync($"/surveys/{survey.Id}/export/csv");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = Rows(await response.Content.ReadAsByteArrayAsync());

        Assert.Equal("0-100", Cell(rows, SurveyExport.SummarySection, "score_scale", "value"));
        Assert.Equal("83.4", Cell(rows, SurveyExport.QuestionSection, survey.Questions[0].Id.ToString(), "average"));
        Assert.Equal("80", Cell(rows, SurveyExport.QuestionSection, survey.Questions[0].Id.ToString(), "median"));
        Assert.Equal("83.4", Cell(rows, SurveyExport.DimensionSection, "liderazgo", "average_score"));
        // Counts are not scores.
        Assert.Equal("6", Cell(rows, SurveyExport.SummarySection, "completed_count", "value"));
    }

    /// <summary>One 1–5 likert in "liderazgo", answered 5,4,4,4,4,4 → mean 4,17, median 4.</summary>
    private async Task<SurveyDetail> SeedLikertSurveyAsync(HttpClient admin)
    {
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            _companyId,
            title: SurveyTestHarness.Both("Climate", "Clima"),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("My leader supports me", "Mi líder me apoya"),
                    "likert",
                    ScaleMin: 1,
                    ScaleMax: 5,
                    Category: "liderazgo"),
            ]));

        await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active);

        for (var i = 0; i < 6; i++)
        {
            var value = i == 0 ? "5" : "4";
            await _harness.WithDbAsync(async db =>
            {
                var responseId = Guid.NewGuid();
                db.Responses.Add(new Response
                {
                    Id = responseId,
                    SurveyId = survey.Id,
                    CompanyId = _companyId,
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
                db.QuestionResponses.Add(new QuestionResponse
                {
                    ResponseId = responseId,
                    QuestionId = survey.Questions[0].Id,
                    ResponseValue = JsonSerializer.Serialize(value),
                });
                await db.SaveChangesAsync();
            });
        }

        return survey;
    }

    private sealed record CsvRow(string Section, string Question, string Group, string Metric, string Value);

    private static IReadOnlyList<CsvRow> Rows(byte[] bytes)
        =>
        [
            .. Encoding.UTF8.GetString(bytes.AsSpan(3))
                .Split("\r\n", StringSplitOptions.RemoveEmptyEntries)
                .Skip(1)
                .Select(line => line[1..^1].Split("\",\"", StringSplitOptions.None))
                .Select(f => new CsvRow(f[0], f[1], f[2], f[4], f[5])),
        ];

    private static string Cell(IReadOnlyList<CsvRow> rows, string section, string group, string metric)
        => rows.Single(r => r.Section == section && r.Group == group && r.Metric == metric).Value;
}
