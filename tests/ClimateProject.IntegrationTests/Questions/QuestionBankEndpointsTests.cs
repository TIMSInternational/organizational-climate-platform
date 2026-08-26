using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Questions;

/// <summary>
/// The question BANK — the curation repository (#110).
/// </summary>
/// <remarks>
/// <para>
/// What is pinned here that a unit test could not reach, in the order the issue's acceptance
/// criteria name it:
/// </para>
/// <list type="number">
/// <item><description>
/// <b>Usage and effectiveness do not contend under concurrent submission.</b> Eight
/// respondents finish the same survey at the same time and the bank row is not written
/// ONCE — asserted on Postgres's own <c>xmin</c>, which changes on any update to a tuple,
/// so this is "zero writes" rather than "the number I expected". The numbers are still
/// exactly right afterwards, because they are counted rather than accumulated.
/// </description></item>
/// <item><description>
/// <b>A retired question still resolves for the responses it produced.</b> Retirement is
/// driven through the lifecycle route and then a REAL respondent fetch is made against the
/// survey — the question is still there, with its wording, and the source is still
/// resolvable by id.
/// </description></item>
/// <item><description>
/// <b>Bulk and import authorization.</b> A batch is where a global row hides behind
/// legitimate ones, so the batch is refused whole and nothing at all is written.
/// </description></item>
/// </list>
/// <para>
/// Every survey, question and response below is produced by the real endpoints — the survey
/// wizard writes the provenance column, the respond endpoint writes the answers. Nothing
/// here inserts a <c>questions</c> or <c>question_responses</c> row by hand, because a
/// metric computed over a payload the test wrote itself proves only that the test can add up.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class QuestionBankEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public QuestionBankEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(postgres.App, $"qbank-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Bank Co");
        _otherCompanyId = await _harness.SeedCompanyAsync("Other Co");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    // A super_admin carries no tenant (#191), which is exactly the caller that may write global rows.
    private Task<HttpClient> SuperAdminAsync() => _harness.ClientAsync(Roles.SuperAdmin, null);

    private static CreateQuestionBankItemRequest Item(
        Guid? companyId,
        string text = "How supported do you feel by your manager?",
        string type = QuestionTypes.Likert,
        string category = "leadership",
        string? subcategory = null,
        string? language = null,
        IReadOnlyList<string>? tags = null)
        => new(
            Text: text,
            Type: type,
            Category: category,
            CompanyId: companyId,
            Subcategory: subcategory,
            Language: language,
            ScaleMin: 1,
            ScaleMax: 5,
            Tags: tags ?? ["culture"]);

    private static async Task<QuestionBankItemDetail> CreateItemAsync(HttpClient client, CreateQuestionBankItemRequest request)
    {
        var response = await client.PostAsJsonAsync("/admin/question-bank", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<QuestionBankItemDetail>())!;
    }

    /// <summary>
    /// A live survey whose questions carry bank provenance, built entirely through the survey
    /// endpoint — which is what makes the provenance column a thing PRODUCTION writes rather
    /// than a column this test populates so its own query has something to find.
    /// </summary>
    private async Task<SurveyDetail> ActiveSurveyFromBankAsync(bool anonymous, params Guid[] bankItemIds)
    {
        var admin = await AdminAsync();
        var questions = bankItemIds
            .Select((bankItemId, index) => new CreateSurveyQuestionInput(
                LocalizedInput.FromBare($"Bank question {index}"),
                QuestionTypes.Likert,
                ScaleMin: 1,
                ScaleMax: 5,
                // The first question is required so a completed response always has one
                // answer; the rest are optional, which is what makes a SKIP observable.
                Required: index == 0,
                Order: index,
                SourceQuestionBankItemId: bankItemId))
            .ToList();

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Bank-sourced survey"),
            CompanyId: _companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions: questions,
            Settings: new SurveySettingsInput(Anonymous: anonymous)));

        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return survey;
    }

    /// <summary>
    /// Postgres's own row version. It advances on ANY update to the tuple, including one that
    /// writes the value already there, so an unchanged reading is proof of zero writes rather
    /// than of an arithmetic result that happened to match.
    /// </summary>
    private Task<long> RowVersionAsync(Guid itemId)
        => _harness.WithDbAsync(db => db.Database
            .SqlQuery<long>($"""SELECT xmin::text::bigint AS "Value" FROM question_bank_items WHERE "Id" = {itemId}""")
            .SingleAsync());

    private Task<QuestionBankItem> RowAsync(Guid itemId)
        => _harness.WithDbAsync(db => db.QuestionBankItems.AsNoTracking().FirstAsync(i => i.Id == itemId));

    // ------------------------------------------------------------------
    // CRUD, categories and the tenant split
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_company_admin_creates_a_bank_question_in_their_own_company()
    {
        var admin = await AdminAsync();

        var item = await CreateItemAsync(admin, Item(_companyId, subcategory: "support", tags: ["culture", "manager"]));

        Assert.Equal("How supported do you feel by your manager?", item.Text);
        // Monolingual, unlike the library: the bank's language names the ONE column its text
        // is in, and "both" is not a language a bank item can be in.
        Assert.Equal(ContentLanguages.English, item.Language);
        Assert.Equal("leadership", item.Category);
        Assert.Equal("support", item.Subcategory);
        Assert.Equal(["culture", "manager"], item.Tags);
        Assert.Equal(0, item.UsageCount);
        Assert.True(item.IsActive);

        var stored = await RowAsync(item.Id);
        Assert.Equal("How supported do you feel by your manager?", stored.TextEn);
        Assert.Null(stored.TextEs);
    }

    [Fact]
    public async Task A_spanish_question_is_stored_in_the_spanish_column_and_read_back_from_it()
    {
        var admin = await AdminAsync();

        var item = await CreateItemAsync(
            admin, Item(_companyId, text: "¿Qué tan apoyado te sientes?", language: ContentLanguages.Spanish));

        Assert.Equal("¿Qué tan apoyado te sientes?", item.Text);
        Assert.Equal(ContentLanguages.Spanish, item.Language);

        var stored = await RowAsync(item.Id);
        Assert.Equal("¿Qué tan apoyado te sientes?", stored.TextEs);
        Assert.Null(stored.TextEn);
    }

    [Fact]
    public async Task A_language_of_both_is_refused_because_a_bank_question_holds_one_string()
    {
        var admin = await AdminAsync();

        var response = await admin.PostAsJsonAsync(
            "/admin/question-bank", Item(_companyId, language: ContentLanguages.Both));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// The tenant split, and the whole reason read and write are separate checks: a global row
    /// is visible to every tenant, so letting one tenant write it is a cross-tenant write.
    /// </summary>
    [Fact]
    public async Task A_company_admin_may_read_a_global_question_but_not_create_or_edit_one()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateItemAsync(superAdmin, Item(null, text: "Global question", category: "engagement"));

        var admin = await AdminAsync();

        var read = await admin.GetAsync($"/admin/question-bank/{global.Id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        var create = await admin.PostAsJsonAsync("/admin/question-bank", Item(null, text: "Sneaky"));
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);

        var edit = await admin.PutAsJsonAsync(
            $"/admin/question-bank/{global.Id}", new UpdateQuestionBankItemRequest("Rewritten", "engagement"));
        Assert.Equal(HttpStatusCode.Forbidden, edit.StatusCode);
    }

    [Fact]
    public async Task Another_tenants_question_is_invisible_and_unreachable()
    {
        var superAdmin = await SuperAdminAsync();
        var theirs = await CreateItemAsync(superAdmin, Item(_otherCompanyId, text: "Their question"));

        var admin = await AdminAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"/admin/question-bank/{theirs.Id}")).StatusCode);

        var list = await admin.GetFromJsonAsync<QuestionBankListResponse>("/admin/question-bank");
        Assert.DoesNotContain(list!.Items, i => i.Id == theirs.Id);
    }

    [Fact]
    public async Task An_employee_is_refused_the_bank_entirely()
    {
        var employee = await _harness.ClientAsync(Roles.Employee, _companyId);

        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/admin/question-bank")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/admin/question-bank/categories")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/admin/question-bank/analytics")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/admin/question-bank/effectiveness")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/admin/question-bank/usage-tracking")).StatusCode);
    }

    /// <summary>
    /// The bank's vocabulary is <c>QuestionTypes.ForSurvey</c> — legacy QuestionBank's own six.
    /// A bank item is instantiated into a SURVEY, so accepting a type the survey endpoint
    /// rejects would let a curator build a question that cannot be asked.
    /// </summary>
    [Fact]
    public async Task A_type_a_survey_cannot_ask_is_refused_at_curation_time()
    {
        var admin = await AdminAsync();

        var response = await admin.PostAsJsonAsync(
            "/admin/question-bank", Item(_companyId, type: QuestionTypes.EmojiRating));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain(QuestionTypes.EmojiRating, QuestionTypes.ForSurvey);
    }

    [Fact]
    public async Task A_multiple_choice_question_needs_at_least_two_options()
    {
        var admin = await AdminAsync();

        var one = await admin.PostAsJsonAsync("/admin/question-bank", new CreateQuestionBankItemRequest(
            "Pick one", QuestionTypes.MultipleChoice, "engagement", _companyId,
            Options: [new QuestionBankOptionInput(null, "Remote")]));
        Assert.Equal(HttpStatusCode.BadRequest, one.StatusCode);

        var two = await admin.PostAsJsonAsync("/admin/question-bank", new CreateQuestionBankItemRequest(
            "Pick one", QuestionTypes.MultipleChoice, "engagement", _companyId,
            Options: [new QuestionBankOptionInput(null, "Remote"), new QuestionBankOptionInput(null, "Hybrid")]));
        Assert.Equal(HttpStatusCode.Created, two.StatusCode);

        var created = (await two.Content.ReadFromJsonAsync<QuestionBankItemDetail>())!;
        // The stable value is derived from the label when the caller supplies none -- an
        // answer is stored by value, so it must never be a per-locale display string.
        Assert.Equal(["Remote", "Hybrid"], created.Options.Select(o => o.Value));
        Assert.Equal(["Remote", "Hybrid"], created.Options.Select(o => o.Label));
    }

    [Fact]
    public async Task Categories_are_counted_from_the_rows_rather_than_stored()
    {
        var admin = await AdminAsync();
        await CreateItemAsync(admin, Item(_companyId, text: "A", category: "wellbeing", subcategory: "workload"));
        await CreateItemAsync(admin, Item(_companyId, text: "B", category: "wellbeing", subcategory: "workload"));
        await CreateItemAsync(admin, Item(_companyId, text: "C", category: "wellbeing", subcategory: "balance"));

        var categories = await admin.GetFromJsonAsync<QuestionBankCategoriesResponse>("/admin/question-bank/categories");

        var workload = categories!.Categories.Single(c => c.Category == "wellbeing" && c.Subcategory == "workload");
        var balance = categories.Categories.Single(c => c.Category == "wellbeing" && c.Subcategory == "balance");
        Assert.Equal(2, workload.ItemCount);
        Assert.Equal(2, workload.ActiveItemCount);
        Assert.Equal(1, balance.ItemCount);
    }

    [Fact]
    public async Task A_search_matches_the_language_the_question_is_actually_in()
    {
        var admin = await AdminAsync();
        var spanish = await CreateItemAsync(
            admin, Item(_companyId, text: "¿Recomendarías este lugar de trabajo?", language: ContentLanguages.Spanish));

        var hits = await admin.GetFromJsonAsync<QuestionBankListResponse>(
            "/admin/question-bank?search=Recomendar%C3%ADas");

        Assert.Contains(hits!.Items, i => i.Id == spanish.Id);
    }

    // ------------------------------------------------------------------
    // Variations
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_variation_hangs_off_its_parent_and_inherits_its_type_and_category()
    {
        var admin = await AdminAsync();
        var parent = await CreateItemAsync(admin, Item(_companyId, text: "Do you feel heard?", category: "voice"));

        var created = await admin.PostAsJsonAsync(
            $"/admin/question-bank/{parent.Id}/variations",
            new CreateQuestionBankVariationRequest("Does your opinion reach the people who decide?"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var variation = (await created.Content.ReadFromJsonAsync<QuestionBankItemDetail>())!;

        Assert.Equal(parent.Id, variation.ParentQuestionBankItemId);
        Assert.Equal(parent.Type, variation.Type);
        Assert.Equal("voice", variation.Category);

        var listed = await admin.GetFromJsonAsync<QuestionBankVariationsResponse>(
            $"/admin/question-bank/{parent.Id}/variations");
        Assert.Equal([variation.Id], listed!.Variations.Select(v => v.Id));

        // One level deep: a variation of a variation is a tree whose root nobody can find.
        var nested = await admin.PostAsJsonAsync(
            $"/admin/question-bank/{variation.Id}/variations",
            new CreateQuestionBankVariationRequest("A third phrasing"));
        Assert.Equal(HttpStatusCode.BadRequest, nested.StatusCode);
    }

    // ------------------------------------------------------------------
    // Bulk and import authorization  (acceptance criterion 4)
    // ------------------------------------------------------------------

    /// <summary>
    /// <b>The batch is where a global row hides.</b> A guard that ran per row as it inserted
    /// would leave the legitimate rows committed and report a failure — a partial success on a
    /// privilege boundary, which also tells the caller exactly which position the guard sits at.
    /// So every row is checked before any row is written, and the proof is that NOTHING from
    /// the batch exists afterwards, not merely that the call returned 403.
    /// </summary>
    [Fact]
    public async Task A_bulk_batch_hiding_a_global_row_is_refused_whole_and_writes_nothing()
    {
        var admin = await AdminAsync();
        var marker = $"bulk-{Guid.NewGuid():N}";

        var response = await admin.PostAsJsonAsync("/admin/question-bank/bulk", new BulkCreateQuestionBankItemsRequest(
        [
            Item(_companyId, text: $"{marker} one"),
            // Global: visible to every tenant, and therefore SuperAdmin-only to write.
            Item(null, text: $"{marker} two"),
            Item(_companyId, text: $"{marker} three"),
        ]));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var written = await _harness.WithDbAsync(db => db.QuestionBankItems
            .CountAsync(i => i.TextEn != null && i.TextEn.StartsWith(marker)));
        Assert.Equal(0, written);
    }

    /// <summary>
    /// Import is a bulk create with a duplicate check on top. The one thing it must not be is
    /// a bulk create with a weaker guard, so the rule is asserted on both routes rather than
    /// on the one that happened to get written first.
    /// </summary>
    [Fact]
    public async Task An_import_hiding_a_global_row_is_refused_whole_and_writes_nothing()
    {
        var admin = await AdminAsync();
        var marker = $"import-{Guid.NewGuid():N}";

        var response = await admin.PostAsJsonAsync("/admin/question-bank/import", new ImportQuestionBankItemsRequest(
        [
            Item(_companyId, text: $"{marker} one"),
            Item(null, text: $"{marker} two"),
        ]));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var written = await _harness.WithDbAsync(db => db.QuestionBankItems
            .CountAsync(i => i.TextEn != null && i.TextEn.StartsWith(marker)));
        Assert.Equal(0, written);
    }

    [Fact]
    public async Task A_super_admin_may_bulk_create_global_questions()
    {
        var superAdmin = await SuperAdminAsync();
        var marker = $"global-{Guid.NewGuid():N}";

        var response = await superAdmin.PostAsJsonAsync("/admin/question-bank/bulk", new BulkCreateQuestionBankItemsRequest(
        [
            Item(null, text: $"{marker} one"),
            Item(null, text: $"{marker} two"),
        ]));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<QuestionBankWriteResultResponse>())!;
        Assert.Equal(2, result.Created);
        Assert.Empty(result.SkippedAsDuplicate);
        Assert.All(result.Items, i => Assert.Null(i.CompanyId));
    }

    /// <summary>
    /// An import is run more than once — that is what makes it an import rather than a create.
    /// Re-running the same file must not double the corpus.
    /// </summary>
    [Fact]
    public async Task Re_importing_the_same_questions_skips_them_instead_of_duplicating_them()
    {
        var admin = await AdminAsync();
        var marker = $"dedupe-{Guid.NewGuid():N}";
        var payload = new ImportQuestionBankItemsRequest(
        [
            Item(_companyId, text: $"{marker} one"),
            Item(_companyId, text: $"{marker} two"),
        ]);

        var first = await admin.PostAsJsonAsync("/admin/question-bank/import", payload);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(2, (await first.Content.ReadFromJsonAsync<QuestionBankWriteResultResponse>())!.Created);

        var second = await admin.PostAsJsonAsync("/admin/question-bank/import", payload);
        var result = (await second.Content.ReadFromJsonAsync<QuestionBankWriteResultResponse>())!;
        Assert.Equal(0, result.Created);
        Assert.Equal([0, 1], result.SkippedAsDuplicate);

        var stored = await _harness.WithDbAsync(db => db.QuestionBankItems
            .CountAsync(i => i.TextEn != null && i.TextEn.StartsWith(marker)));
        Assert.Equal(2, stored);
    }

    // ------------------------------------------------------------------
    // Usage / effectiveness under concurrency  (acceptance criterion 2)
    // ------------------------------------------------------------------

    /// <summary>
    /// <b>Eight respondents finish at the same instant and the bank row is never written.</b>
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the acceptance criterion "usage/effectiveness updates do not contend under
    /// concurrent submission", asserted as the strongest form it has: not "the counter came
    /// out right" and not "it was fast enough", but that the submission path performs ZERO
    /// writes to <c>question_bank_items</c>. <c>xmin</c> is Postgres's own per-tuple
    /// transaction stamp and it advances on any UPDATE, including one that stores the value
    /// already there, so an unchanged reading cannot be produced by a write that happened to
    /// be idempotent.
    /// </para>
    /// <para>
    /// The second half matters as much as the first: the numbers are then exactly right.
    /// A design that avoided contention by not counting at all would pass the first assertion
    /// and fail this one.
    /// </para>
    /// <para>
    /// Each respondent gets its own <c>HttpClient</c>, which is what gives it its own
    /// rate-limit partition on this shared host (see <c>AuthWebApplicationFactory</c>), so the
    /// concurrency being measured is the database's and not the limiter's.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task Concurrent_submissions_never_write_the_bank_row_and_the_numbers_are_still_exact()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Concurrency probe", category: "engagement"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: true, item.Id);
        var questionId = survey.Questions[0].Id;

        var versionBefore = await RowVersionAsync(item.Id);
        const int respondents = 8;

        var submissions = Enumerable.Range(0, respondents).Select(async _ =>
        {
            var client = _factory.CreateClient();
            return await client.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
                Answers: [new SurveyAnswerInput(questionId, "4")],
                SessionId: Guid.NewGuid().ToString("N"),
                IsComplete: true,
                Language: ContentLanguages.English));
        }).ToList();

        var results = await Task.WhenAll(submissions);
        Assert.All(results, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));

        // Zero writes. Not "one write per survey", not "a write we can live with".
        Assert.Equal(versionBefore, await RowVersionAsync(item.Id));

        var row = await RowAsync(item.Id);
        Assert.Equal(0, row.UsageCount);
        Assert.Equal(0d, row.ResponseRate);
        Assert.Null(row.LastUsedAt);

        // ...and yet the derived numbers are exact, because they are counted on demand.
        var metrics = await admin.GetFromJsonAsync<QuestionBankMetricsDto>(
            $"/admin/question-bank/{item.Id}/metrics");
        Assert.Equal(1, metrics!.SurveysUsedIn);
        Assert.Equal(1, metrics.QuestionsCreated);
        Assert.Equal(respondents, metrics.TimesAsked);
        Assert.Equal(respondents, metrics.TimesAnswered);
        Assert.Equal(100d, metrics.ResponseRate);
        Assert.Equal(0d, metrics.SkipRate);
        Assert.NotNull(metrics.LastUsedAt);
    }

    /// <summary>
    /// Effectiveness is about how a question BEHAVES, so the ranking has to move when
    /// respondents skip one and answer the other. Both questions live in the same survey and
    /// are answered by the same people, which is what removes every explanation for the gap
    /// except the questions themselves.
    /// </summary>
    [Fact]
    public async Task A_question_respondents_skip_ranks_below_one_they_answer()
    {
        var admin = await AdminAsync();
        var answered = await CreateItemAsync(admin, Item(_companyId, text: "Answered probe", category: "ranking-probe"));
        var skipped = await CreateItemAsync(admin, Item(_companyId, text: "Skipped probe", category: "ranking-probe"));

        var survey = await ActiveSurveyFromBankAsync(anonymous: true, answered.Id, skipped.Id);
        var answeredQuestionId = survey.Questions.Single(q => q.Order == 0).Id;
        var skippedQuestionId = survey.Questions.Single(q => q.Order == 1).Id;

        // Four complete responses. Every one answers the first question; exactly one also
        // answers the second, which is a 100% / 25% split at the SAME denominator.
        for (var i = 0; i < 4; i++)
        {
            var client = _factory.CreateClient();
            var answers = new List<SurveyAnswerInput> { new(answeredQuestionId, "4") };
            if (i == 0) answers.Add(new SurveyAnswerInput(skippedQuestionId, "3"));

            var response = await client.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
                Answers: answers,
                SessionId: Guid.NewGuid().ToString("N"),
                IsComplete: true,
                Language: ContentLanguages.English));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        var effectiveness = await admin.GetFromJsonAsync<QuestionBankEffectivenessResponse>(
            "/admin/question-bank/effectiveness?category=ranking-probe");

        var ranked = effectiveness!.Items.ToList();
        Assert.Equal(2, ranked.Count);
        Assert.Equal(answered.Id, ranked[0].QuestionBankItemId);
        Assert.Equal(skipped.Id, ranked[1].QuestionBankItemId);

        Assert.Equal(4, ranked[0].Metrics.TimesAsked);
        Assert.Equal(4, ranked[0].Metrics.TimesAnswered);
        Assert.Equal(100d, ranked[0].Metrics.ResponseRate);

        Assert.Equal(4, ranked[1].Metrics.TimesAsked);
        Assert.Equal(1, ranked[1].Metrics.TimesAnswered);
        Assert.Equal(25d, ranked[1].Metrics.ResponseRate);
        Assert.Equal(75d, ranked[1].Metrics.SkipRate);
    }

    /// <summary>
    /// The measurement route is the ONLY writer of the stored snapshot columns, and it is an
    /// admin action rather than anything a respondent can reach. Before it runs the row still
    /// reads zero even though the question has been answered — which is the point: the stored
    /// value is a published snapshot, and every read route serves the derived number instead.
    /// </summary>
    [Fact]
    public async Task The_measurement_route_publishes_the_derived_numbers_onto_the_row()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Snapshot probe", category: "snapshot-probe"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: true, item.Id);

        var respondent = _factory.CreateClient();
        var submitted = await respondent.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "5")],
            SessionId: Guid.NewGuid().ToString("N"),
            IsComplete: true,
            Language: ContentLanguages.English));
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);

        Assert.Equal(0, (await RowAsync(item.Id)).UsageCount);

        var measured = await admin.PostAsJsonAsync(
            "/admin/question-bank/effectiveness-measurement",
            new QuestionBankEffectivenessMeasurementRequest(ItemIds: [item.Id]));
        Assert.Equal(HttpStatusCode.OK, measured.StatusCode);
        var result = (await measured.Content.ReadFromJsonAsync<QuestionBankEffectivenessMeasurementResponse>())!;
        Assert.Equal(1, result.Examined);
        Assert.Equal(1, result.Refreshed);

        var row = await RowAsync(item.Id);
        Assert.Equal(1, row.UsageCount);
        Assert.Equal(100d, row.ResponseRate);
        Assert.NotNull(row.LastUsedAt);
    }

    [Fact]
    public async Task A_company_admin_cannot_publish_a_snapshot_onto_a_global_row()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateItemAsync(superAdmin, Item(null, text: "Global snapshot probe"));

        var admin = await AdminAsync();
        var response = await admin.PostAsJsonAsync(
            "/admin/question-bank/effectiveness-measurement",
            new QuestionBankEffectivenessMeasurementRequest(ItemIds: [global.Id]));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Usage_tracking_names_the_surveys_a_question_was_copied_into()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Usage probe", category: "usage-probe"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: false, item.Id);

        var usage = await admin.GetFromJsonAsync<QuestionBankUsageResponse>(
            $"/admin/question-bank/usage-tracking?itemId={item.Id}");

        var tracked = usage!.Items.Single();
        Assert.Equal(item.Id, tracked.QuestionBankItemId);
        Assert.Equal(1, tracked.UsageCount);
        var usedIn = tracked.Surveys.Single();
        Assert.Equal(survey.Id, usedIn.SurveyId);
        Assert.Equal(survey.Questions[0].Id, usedIn.QuestionId);
        Assert.Equal(SurveyStatuses.Active, usedIn.SurveyStatus);
    }

    // ------------------------------------------------------------------
    // Lifecycle and historical resolution  (acceptance criterion 3)
    // ------------------------------------------------------------------

    /// <summary>
    /// <b>Retiring a question leaves every response to it interpretable.</b>
    /// </summary>
    /// <remarks>
    /// <para>
    /// The assertion that matters is the respondent-facing one: after retirement, a real fetch
    /// of the survey still returns the question with its wording. That works because
    /// instantiation is a COPY — but "works because of an argument" is what this test exists
    /// to replace, since the argument would survive unchanged while somebody changed
    /// retirement into a delete.
    /// </para>
    /// <para>
    /// Then the provenance itself: the retired source is still resolvable by id (treating
    /// "retired" as "gone" is exactly what makes a historical response unexplainable), it
    /// still owns its usage and its metrics, and it has dropped out of the default listing so
    /// no author picks it again.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task A_retired_question_still_resolves_for_the_responses_it_produced()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Retirement probe", category: "retirement-probe"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: true, item.Id);
        var questionId = survey.Questions[0].Id;

        var respondent = _factory.CreateClient();
        (await respondent.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(questionId, "4")],
            SessionId: Guid.NewGuid().ToString("N"),
            IsComplete: true,
            Language: ContentLanguages.English))).EnsureSuccessStatusCode();

        var retired = await admin.PutAsJsonAsync(
            $"/admin/question-bank/{item.Id}/lifecycle",
            new QuestionBankLifecycleRequest(QuestionBankLifecycleStates.Retired));
        Assert.Equal(HttpStatusCode.OK, retired.StatusCode);
        var lifecycle = (await retired.Content.ReadFromJsonAsync<QuestionBankLifecycleResponse>())!;
        Assert.Equal(QuestionBankLifecycleStates.Retired, lifecycle.State);
        Assert.Equal(1, lifecycle.InstantiatedQuestionCount);

        // 1. The survey still asks the question, in the respondent's own view of it.
        var view = _factory.CreateClient();
        var respondView = await view.GetAsync($"/surveys/{survey.Id}/respond");
        Assert.Equal(HttpStatusCode.OK, respondView.StatusCode);
        var payload = (await respondView.Content.ReadFromJsonAsync<SurveyRespondView>())!;
        var stillAsked = payload.Questions.Single(q => q.Id == questionId);
        Assert.Equal("Bank question 0", stillAsked.Text);

        // 2. The source is still resolvable by id -- "retired" is not "gone".
        var source = await admin.GetFromJsonAsync<QuestionBankItemDetail>($"/admin/question-bank/{item.Id}");
        Assert.False(source!.IsActive);
        Assert.Equal("Retirement probe", source.Text);

        // 3. It still owns the response it produced.
        var metrics = await admin.GetFromJsonAsync<QuestionBankMetricsDto>($"/admin/question-bank/{item.Id}/metrics");
        Assert.Equal(1, metrics!.TimesAsked);
        Assert.Equal(1, metrics.TimesAnswered);

        var usage = await admin.GetFromJsonAsync<QuestionBankUsageResponse>(
            $"/admin/question-bank/usage-tracking?itemId={item.Id}");
        Assert.Equal(survey.Id, usage!.Items.Single().Surveys.Single().SurveyId);

        // 4. ...and it is no longer offered to authors.
        var offered = await admin.GetFromJsonAsync<QuestionBankListResponse>(
            "/admin/question-bank?category=retirement-probe");
        Assert.DoesNotContain(offered!.Items, i => i.Id == item.Id);

        var everything = await admin.GetFromJsonAsync<QuestionBankListResponse>(
            "/admin/question-bank?category=retirement-probe&includeRetired=true");
        Assert.Contains(everything!.Items, i => i.Id == item.Id);
    }

    /// <summary>
    /// Retirement is the ONLY removal for a question that has been asked. A delete would sever
    /// the provenance an answer's explanation hangs off, with no error and with row counts that
    /// reconcile exactly.
    /// </summary>
    [Fact]
    public async Task A_question_that_has_been_asked_cannot_be_deleted()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Delete probe", category: "delete-probe"));
        await ActiveSurveyFromBankAsync(anonymous: false, item.Id);

        var refused = await admin.DeleteAsync($"/admin/question-bank/{item.Id}");
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);

        Assert.NotNull(await RowAsync(item.Id));
    }

    [Fact]
    public async Task A_question_nothing_has_used_can_be_deleted()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Unused probe", category: "delete-probe"));

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/admin/question-bank/{item.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/admin/question-bank/{item.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_retired_question_can_be_brought_back()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Round trip probe"));

        await admin.PutAsJsonAsync(
            $"/admin/question-bank/{item.Id}/lifecycle",
            new QuestionBankLifecycleRequest(QuestionBankLifecycleStates.Retired));
        var reactivated = await admin.PutAsJsonAsync(
            $"/admin/question-bank/{item.Id}/lifecycle",
            new QuestionBankLifecycleRequest(QuestionBankLifecycleStates.Active));

        Assert.Equal(HttpStatusCode.OK, reactivated.StatusCode);
        Assert.Equal(
            QuestionBankLifecycleStates.Active,
            (await reactivated.Content.ReadFromJsonAsync<QuestionBankLifecycleResponse>())!.State);
        Assert.True((await RowAsync(item.Id)).IsActive);
    }

    [Fact]
    public async Task An_unknown_lifecycle_state_is_refused()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Bad state probe"));

        var response = await admin.PutAsJsonAsync(
            $"/admin/question-bank/{item.Id}/lifecycle", new QuestionBankLifecycleRequest("deleted"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Provenance, written by the survey wizard
    // ------------------------------------------------------------------

    /// <summary>
    /// A foreign key cannot catch this: it only knows the row exists. Recording provenance
    /// against another tenant's private question would leak the fact of it, and would make
    /// that tenant's usage numbers count surveys they cannot see.
    /// </summary>
    [Fact]
    public async Task A_survey_may_not_cite_another_tenants_bank_question()
    {
        var superAdmin = await SuperAdminAsync();
        var theirs = await CreateItemAsync(superAdmin, Item(_otherCompanyId, text: "Their private question"));

        var admin = await AdminAsync();
        var response = await admin.PostAsJsonAsync("/surveys", new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Borrowed"),
            CompanyId: _companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Borrowed question"),
                    QuestionTypes.Likert,
                    Order: 0,
                    SourceQuestionBankItemId: theirs.Id),
            ]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// A retired source is still a valid provenance. Refusing it would mean that re-saving an
    /// untouched draft starts failing the day somebody retires a question it was built from.
    /// </summary>
    [Fact]
    public async Task A_survey_may_still_cite_a_retired_bank_question()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Retired source probe"));
        await admin.PutAsJsonAsync(
            $"/admin/question-bank/{item.Id}/lifecycle",
            new QuestionBankLifecycleRequest(QuestionBankLifecycleStates.Retired));

        var survey = await ActiveSurveyFromBankAsync(anonymous: false, item.Id);

        var stored = await _harness.WithDbAsync(db => db.Questions
            .AsNoTracking().FirstAsync(q => q.SurveyId == survey.Id));
        Assert.Equal(item.Id, stored.SourceQuestionBankItemId);
    }

    [Fact]
    public async Task Analytics_counts_the_corpus_the_caller_can_see()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Analytics probe", category: "analytics-probe"));
        await admin.PostAsJsonAsync(
            $"/admin/question-bank/{item.Id}/variations",
            new CreateQuestionBankVariationRequest("Analytics probe, rephrased"));

        var analytics = await admin.GetFromJsonAsync<QuestionBankAnalyticsResponse>("/admin/question-bank/analytics");

        Assert.True(analytics!.TotalItems >= 2);
        Assert.True(analytics.ItemsWithVariations >= 1);
        Assert.Contains(analytics.ByCategory, c => c.Category == "analytics-probe" && c.ItemCount == 2);
        Assert.Contains(analytics.ByType, t => t.Type == QuestionTypes.Likert);
    }
}
