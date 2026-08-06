using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Duplication end to end. The unit tests prove the mapping; these prove the rows
/// actually land in Postgres, that responses are not among them, and that the copy's
/// option values are byte-identical to the original's -- without which the copy's
/// responses aggregate with nothing, silently and with reconciling row counts.
/// </summary>
[Collection("Postgres")]
public class SurveyDuplicationEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public SurveyDuplicationEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
        _harness = new SurveyTestHarness(_factory, $"dup-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        _companyId = await _harness.SeedCompanyAsync("Duplication Co");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Engineering");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private CreateSurveyRequest BilingualRequest() => SurveyTestHarness.MinimalRequest(
        _companyId,
        title: SurveyTestHarness.Both("Q3 Climate Survey", "Encuesta de Clima Q3"),
        language: ContentLanguages.Both,
        departmentIds: [_departmentId],
        questions:
        [
            new CreateSurveyQuestionInput(
                SurveyTestHarness.Both("Are you satisfied?", "Estas satisfecho?"),
                "yes_no",
                Order: 0,
                Required: true),
            new CreateSurveyQuestionInput(
                SurveyTestHarness.Both("Which area needs work?", "Que area necesita trabajo?"),
                "multiple_choice",
                Options:
                [
                    new CreateSurveyQuestionOptionInput("leadership", SurveyTestHarness.Both("Leadership", "Liderazgo")),
                    new CreateSurveyQuestionOptionInput("tooling", SurveyTestHarness.Both("Tooling", "Herramientas")),
                ],
                Order: 1),
        ]);

    private static async Task<SurveyDetail> DuplicateAsync(HttpClient client, Guid surveyId, DuplicateSurveyRequest? request = null)
    {
        var response = await client.PostAsJsonAsync($"/surveys/{surveyId}/duplicate", request ?? new DuplicateSurveyRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
    }

    // ------------------------------------------------------------------
    // The subtle part
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_copys_option_rows_keep_the_originals_stable_values_so_responses_still_aggregate()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());

        var copy = await DuplicateAsync(client, original.Id);

        var originalValues = await LoadOptionValuesAsync(original.Id);
        var copyValues = await LoadOptionValuesAsync(copy.Id);

        Assert.Equal(["leadership", "tooling"], originalValues);
        Assert.Equal(originalValues, copyValues);
    }

    [Fact]
    public async Task An_answer_stored_against_the_original_matches_an_answer_stored_against_the_copy()
    {
        // The property the stable value exists for, stated the way it actually bites: two
        // separate surveys' response rows must be joinable on response_value alone.
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());
        var copy = await DuplicateAsync(client, original.Id);

        var originalChoice = await LoadChoiceQuestionIdAsync(original.Id);
        var copyChoice = await LoadChoiceQuestionIdAsync(copy.Id);

        await _harness.WithDbAsync(async db =>
        {
            var originalResponseId = await SeedResponseWithAnswerAsync(db, original.Id, _companyId, originalChoice, "leadership");
            var copyResponseId = await SeedResponseWithAnswerAsync(db, copy.Id, _companyId, copyChoice, "leadership");

            var values = await db.QuestionResponses
                .Where(r => r.ResponseId == originalResponseId || r.ResponseId == copyResponseId)
                .Select(r => r.ResponseValue)
                .ToListAsync();

            Assert.Equal(2, values.Count);
            Assert.Single(values.Distinct());
        });
    }

    [Fact]
    public async Task Option_labels_survive_in_both_languages_and_keep_their_order()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());

        var copy = await DuplicateAsync(client, original.Id);

        var english = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{copy.Id}?lang=en");
        var spanish = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{copy.Id}?lang=es");

        Assert.Equal(
            ["Leadership", "Tooling"],
            english!.Questions.Single(q => q.Type == "multiple_choice").Options!.Select(o => o.Label));
        Assert.Equal(
            ["Liderazgo", "Herramientas"],
            spanish!.Questions.Single(q => q.Type == "multiple_choice").Options!.Select(o => o.Label));
        Assert.Empty(english.FallbackFields);
        Assert.Empty(spanish.FallbackFields);
    }

    [Fact]
    public async Task Both_title_halves_are_copied_each_with_its_own_locales_suffix()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());

        var copy = await DuplicateAsync(client, original.Id);

        var stored = await _harness.WithDbAsync(db => db.Surveys.FirstAsync(s => s.Id == copy.Id));
        // Never " (Copy)" in the Spanish column -- an English suffix filed under title_es
        // is a silent leak nothing downstream could ever detect.
        Assert.Equal("Q3 Climate Survey (Copy)", stored.TitleEn);
        Assert.Equal("Encuesta de Clima Q3 (Copia)", stored.TitleEs);
    }

    [Fact]
    public async Task The_copy_of_a_bilingual_survey_is_immediately_publishable()
    {
        // Proves the copy is complete in BOTH languages rather than in whichever one the
        // duplicating admin happened to be viewing: a half-copied survey would fail the
        // publish gate here.
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());
        var copy = await DuplicateAsync(client, original.Id);

        var publish = await SurveyTestHarness.SetStatusAsync(client, copy.Id, SurveyStatuses.Active);

        Assert.Equal(HttpStatusCode.OK, publish.StatusCode);
    }

    // ------------------------------------------------------------------
    // Structure yes, history no
    // ------------------------------------------------------------------

    [Fact]
    public async Task Duplicating_copies_structure_and_targeting_but_never_responses()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());
        (await SurveyTestHarness.SetStatusAsync(client, original.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        await _harness.SeedResponseAsync(original.Id, _companyId, null);
        await _harness.SeedResponseAsync(original.Id, _companyId, null);

        var copy = await DuplicateAsync(client, original.Id);

        Assert.Equal(SurveyStatuses.Draft, copy.Status);
        Assert.Equal(0, copy.ResponseCount);
        Assert.Equal(1, copy.Version);
        Assert.Equal(2, copy.Questions.Count);
        Assert.Equal([_departmentId], copy.DepartmentIds);
        Assert.True(copy.IsContentEditable);

        Assert.Equal(0, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == copy.Id)));
        Assert.Equal(2, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == original.Id)));
    }

    [Fact]
    public async Task The_original_is_left_completely_untouched()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());
        (await SurveyTestHarness.SetStatusAsync(client, original.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        await DuplicateAsync(client, original.Id);

        var reloaded = await _harness.WithDbAsync(db => db.Surveys.FirstAsync(s => s.Id == original.Id));
        Assert.Equal(SurveyStatuses.Active, reloaded.Status);
        Assert.Equal("Q3 Climate Survey", reloaded.TitleEn);
        Assert.Equal("Encuesta de Clima Q3", reloaded.TitleEs);
        Assert.Equal(2, await _harness.WithDbAsync(db => db.Questions.CountAsync(q => q.SurveyId == original.Id)));
    }

    [Fact]
    public async Task A_closed_survey_can_be_duplicated_which_is_the_supported_way_to_run_it_again()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());
        (await SurveyTestHarness.SetStatusAsync(client, original.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        (await SurveyTestHarness.SetStatusAsync(client, original.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        var copy = await DuplicateAsync(client, original.Id);

        Assert.Equal(SurveyStatuses.Draft, copy.Status);
        var edit = await client.PutAsJsonAsync($"/surveys/{copy.Id}", new UpdateSurveyRequest(
            Title: SurveyTestHarness.Both("Q4 Climate Survey", "Encuesta de Clima Q4")));
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
    }

    [Fact]
    public async Task Conditional_logic_is_rewired_to_the_copys_own_questions()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());

        var originalQuestionIds = await _harness.WithDbAsync(db => db.Questions
            .Where(q => q.SurveyId == original.Id)
            .OrderBy(q => q.Order)
            .Select(q => q.Id)
            .ToListAsync());

        // There is no endpoint that authors conditional logic yet, so it is seeded
        // directly -- rows will exist from the #154 import regardless, and a duplicate that
        // left them pointing at the original's questions would wire the copy's branching to
        // a different survey.
        await _harness.WithDbAsync(async db =>
        {
            db.QuestionConditionalLogics.Add(new QuestionConditionalLogic
            {
                QuestionId = originalQuestionIds[1],
                ConditionQuestionId = originalQuestionIds[0],
                ConditionOperator = "equals",
                ConditionValue = "\"no\"",
                Action = "show",
                TargetQuestionId = originalQuestionIds[1],
            });
            await db.SaveChangesAsync();
        });

        var copy = await DuplicateAsync(client, original.Id);

        var copyQuestionIds = await _harness.WithDbAsync(db => db.Questions
            .Where(q => q.SurveyId == copy.Id)
            .OrderBy(q => q.Order)
            .Select(q => q.Id)
            .ToListAsync());

        var logic = await _harness.WithDbAsync(db => db.QuestionConditionalLogics
            .SingleAsync(c => c.QuestionId == copyQuestionIds[1]));

        Assert.Equal(copyQuestionIds[0], logic.ConditionQuestionId);
        Assert.Equal(copyQuestionIds[1], logic.TargetQuestionId);
        Assert.DoesNotContain(originalQuestionIds, id => id == logic.ConditionQuestionId);
    }

    [Fact]
    public async Task Emoji_option_rows_are_copied_even_though_the_api_cannot_author_them()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());

        var firstQuestionId = await _harness.WithDbAsync(db => db.Questions
            .Where(q => q.SurveyId == original.Id)
            .OrderBy(q => q.Order)
            .Select(q => q.Id)
            .FirstAsync());

        // emoji_rating is not in QuestionTypes.ForSurvey, but question_emoji_options is
        // keyed to a survey question and the #154 import will produce rows. Duplication
        // must not quietly drop them.
        await _harness.WithDbAsync(async db =>
        {
            db.QuestionEmojiOptions.Add(new QuestionEmojiOption
            {
                QuestionId = firstQuestionId,
                Order = 0,
                Emoji = "\U0001F600",
                LabelEn = "Great",
                LabelEs = "Genial",
                Value = 5,
            });
            await db.SaveChangesAsync();
        });

        var copy = await DuplicateAsync(client, original.Id);

        var copied = await _harness.WithDbAsync(db => db.QuestionEmojiOptions
            .Where(e => db.Questions.Any(q => q.SurveyId == copy.Id && q.Id == e.QuestionId))
            .SingleAsync());

        Assert.Equal("\U0001F600", copied.Emoji);
        Assert.Equal(("Great", "Genial"), (copied.LabelEn, copied.LabelEs));
        Assert.Equal(5, copied.Value);
    }

    // ------------------------------------------------------------------
    // Overrides and authorization
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_supplied_title_and_window_replace_the_defaults()
    {
        var client = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(client, BilingualRequest());
        var start = DateTimeOffset.UtcNow.AddDays(30);
        var end = DateTimeOffset.UtcNow.AddDays(44);

        var copy = await DuplicateAsync(client, original.Id, new DuplicateSurveyRequest(
            Title: SurveyTestHarness.Both("Q4 Climate Survey", "Encuesta de Clima Q4"),
            StartDate: start,
            EndDate: end));

        Assert.Equal(start.ToUnixTimeSeconds(), copy.StartDate.ToUnixTimeSeconds());
        Assert.Equal(end.ToUnixTimeSeconds(), copy.EndDate.ToUnixTimeSeconds());

        var stored = await _harness.WithDbAsync(db => db.Surveys.FirstAsync(s => s.Id == copy.Id));
        Assert.Equal("Q4 Climate Survey", stored.TitleEn);
        Assert.Equal("Encuesta de Clima Q4", stored.TitleEs);
    }

    [Fact]
    public async Task The_copy_is_attributed_to_the_admin_who_duplicated_it()
    {
        var authorClient = await AdminAsync();
        var original = await SurveyTestHarness.CreateSurveyAsync(authorClient, BilingualRequest());

        var duplicatorClient = await AdminAsync();
        var copy = await DuplicateAsync(duplicatorClient, original.Id);

        Assert.NotEqual(original.CreatedBy, copy.CreatedBy);
    }

    [Fact]
    public async Task Duplicating_a_survey_that_does_not_exist_is_a_404()
    {
        var client = await AdminAsync();

        var response = await client.PostAsJsonAsync($"/surveys/{Guid.NewGuid()}/duplicate", new DuplicateSurveyRequest());

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Task<List<string>> LoadOptionValuesAsync(Guid surveyId)
        => _harness.WithDbAsync(db => db.QuestionOptions
            .Where(o => db.Questions.Any(q => q.SurveyId == surveyId && q.Id == o.QuestionId))
            .OrderBy(o => o.Order)
            .Select(o => o.Value)
            .ToListAsync());

    private Task<Guid> LoadChoiceQuestionIdAsync(Guid surveyId)
        => _harness.WithDbAsync(db => db.Questions
            .Where(q => q.SurveyId == surveyId && q.Type == "multiple_choice")
            .Select(q => q.Id)
            .FirstAsync());

    private static async Task<Guid> SeedResponseWithAnswerAsync(
        ClimateProjectDbContext db,
        Guid surveyId,
        Guid companyId,
        Guid questionId,
        string answerValue)
    {
        var response = new Response
        {
            Id = Guid.NewGuid(),
            SurveyId = surveyId,
            CompanyId = companyId,
            SessionId = Guid.NewGuid().ToString("N"),
            Language = "en",
            IsComplete = true,
            StartTime = DateTimeOffset.UtcNow,
            CompletionTime = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Responses.Add(response);
        db.QuestionResponses.Add(new QuestionResponse
        {
            ResponseId = response.Id,
            QuestionId = questionId,
            ResponseValue = answerValue,
        });
        await db.SaveChangesAsync();
        return response.Id;
    }
}
