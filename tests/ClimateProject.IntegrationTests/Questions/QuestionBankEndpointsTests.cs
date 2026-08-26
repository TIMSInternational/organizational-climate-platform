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
/// WRITE endpoint stores the provenance column, the respond endpoint writes the answers.
/// Nothing here inserts a <c>questions</c> or <c>question_responses</c> row by hand, because
/// a metric computed over a payload the test wrote itself proves only that the test can add up.
/// </para>
/// <para>
/// <b>The producer is the API, not the web wizard.</b> <c>POST /surveys</c> accepts
/// <c>sourceQuestionBankItemId</c> and stores it; no shipped client sends it yet (the
/// wizard's picker reads <c>/admin/question-library</c>), so in production these numbers are
/// a correct count of zero until the bank's own picker exists. That is a real gap and it is
/// named rather than papered over — but it is a gap in the CLIENT, and every rule below
/// (tenant scope, derived-not-stored, retirement, provenance authorization) has to be right
/// before a producer arrives, not after.
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
        => await ActiveSurveyForAsync(await AdminAsync(), _companyId, "Bank-sourced survey", anonymous, bankItemIds);

    /// <summary>
    /// The same thing for a NAMED tenant, so a cross-tenant assertion can put a real survey
    /// in the other company rather than asserting over an empty set on both sides.
    /// </summary>
    private static async Task<SurveyDetail> ActiveSurveyForAsync(
        HttpClient admin, Guid companyId, string title, bool anonymous, params Guid[] bankItemIds)
    {
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
            Title: LocalizedInput.FromBare(title),
            CompanyId: companyId,
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

    /// <summary>
    /// One respondent, through the real respond endpoint, with their own client so the
    /// rate limiter partitions them apart on this shared host.
    /// </summary>
    private async Task SubmitAsync(Guid surveyId, bool isComplete, params (Guid QuestionId, string Value)[] answers)
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync($"/surveys/{surveyId}/responses", new SubmitSurveyResponseRequest(
            Answers: answers.Select(a => new SurveyAnswerInput(a.QuestionId, a.Value)).ToList(),
            SessionId: Guid.NewGuid().ToString("N"),
            IsComplete: isComplete,
            Language: ContentLanguages.English));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task<List<Guid>> ListedIdsAsync(HttpClient client, string query)
        => (await client.GetFromJsonAsync<QuestionBankListResponse>(query))!.Items.Select(i => i.Id).ToList();

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

    /// <summary>
    /// <b>Every route, every role below admin</b> — not the five that happened to be easy.
    /// </summary>
    /// <remarks>
    /// The predecessor of this test checked five collection GETs, all of which gate on the
    /// same <c>Roles.Admin.Contains</c> line at the top of their handler. Deleting the role
    /// line from <c>CanRead</c> or from <c>CanWrite</c> — the two checks that actually stand
    /// between a leader and the corpus — changed nothing it could see: an employee could read
    /// any item and its metrics, or create, edit, retire and delete their tenant's questions,
    /// and 1268 integration tests stayed green. So the sweep is over the whole surface and
    /// over all three non-admin roles, and it ends by proving the item they attacked is
    /// untouched rather than that the calls returned 403.
    /// </remarks>
    [Fact]
    public async Task Every_route_on_the_bank_is_refused_to_every_role_below_admin()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Guard probe", category: "guard-probe"));

        foreach (var role in new[] { Roles.Employee, Roles.Leader, Roles.Supervisor })
        {
            var client = await _harness.ClientAsync(role, _companyId);

            string[] reads =
            [
                "", "/categories", "/analytics", "/effectiveness", "/usage-tracking",
                $"/{item.Id}", $"/{item.Id}/metrics", $"/{item.Id}/variations",
            ];
            foreach (var path in reads)
            {
                Assert.Equal(
                    HttpStatusCode.Forbidden,
                    (await client.GetAsync($"/admin/question-bank{path}")).StatusCode);
            }

            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync("/admin/question-bank", Item(_companyId, text: "Sneak create"))).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await client.PutAsJsonAsync(
                    $"/admin/question-bank/{item.Id}",
                    new UpdateQuestionBankItemRequest("Rewritten by a leader", "guard-probe"))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.DeleteAsync($"/admin/question-bank/{item.Id}")).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync(
                    $"/admin/question-bank/{item.Id}/variations",
                    new CreateQuestionBankVariationRequest("Sneak variation"))).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await client.PutAsJsonAsync(
                    $"/admin/question-bank/{item.Id}/lifecycle",
                    new QuestionBankLifecycleRequest(QuestionBankLifecycleStates.Retired))).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync(
                    "/admin/question-bank/bulk",
                    new BulkCreateQuestionBankItemsRequest([Item(_companyId, text: "Sneak bulk")]))).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync(
                    "/admin/question-bank/import",
                    new ImportQuestionBankItemsRequest([Item(_companyId, text: "Sneak import")]))).StatusCode);
            Assert.Equal(
                HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync(
                    "/admin/question-bank/effectiveness-measurement",
                    new QuestionBankEffectivenessMeasurementRequest())).StatusCode);
        }

        var untouched = await RowAsync(item.Id);
        Assert.Equal("Guard probe", untouched.TextEn);
        Assert.True(untouched.IsActive);
        Assert.Equal(1, untouched.Version);
        Assert.Empty(await ListedIdsAsync(admin, "/admin/question-bank?search=Sneak"));
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

    /// <remarks>
    /// Both halves. Asserting only that the match is present passes with the filter deleted
    /// outright — the unfiltered list contains it too — so the question a search answers
    /// ("which of these, and not the others") is only tested by the exclusion.
    /// </remarks>
    [Fact]
    public async Task A_search_matches_the_language_the_question_is_actually_in_and_excludes_the_rest()
    {
        var admin = await AdminAsync();
        var spanish = await CreateItemAsync(
            admin, Item(_companyId, text: "¿Recomendarías este lugar de trabajo?", language: ContentLanguages.Spanish));
        var english = await CreateItemAsync(
            admin, Item(_companyId, text: "Would you recommend this workplace?"));

        var hits = await ListedIdsAsync(admin, "/admin/question-bank?search=Recomendar%C3%ADas");

        Assert.Contains(spanish.Id, hits);
        Assert.DoesNotContain(english.Id, hits);

        // ...and the English one is found by its own words, so the Spanish column is not
        // simply the only one being searched.
        var englishHits = await ListedIdsAsync(admin, "/admin/question-bank?search=recommend%20this%20workplace");
        Assert.Contains(english.Id, englishHits);
        Assert.DoesNotContain(spanish.Id, englishHits);
    }

    /// <summary>
    /// Every filter, each proved by what it leaves OUT. Two questions differing in every
    /// filterable attribute, so a filter that has quietly become a no-op returns both.
    /// </summary>
    [Fact]
    public async Task Each_filter_excludes_the_questions_it_does_not_name()
    {
        var admin = await AdminAsync();
        var category = $"filter-{Guid.NewGuid():N}";

        var wanted = await CreateItemAsync(admin, new CreateQuestionBankItemRequest(
            Text: "The wanted question",
            Type: QuestionTypes.Likert,
            Category: category,
            CompanyId: _companyId,
            Subcategory: "alpha",
            Industry: "technology",
            CompanySize: "51-200",
            Tags: ["wanted"]));
        var other = await CreateItemAsync(admin, new CreateQuestionBankItemRequest(
            Text: "The other question",
            Type: QuestionTypes.OpenEnded,
            Category: category,
            CompanyId: _companyId,
            Subcategory: "beta",
            Industry: "retail",
            CompanySize: "1-50",
            Tags: ["other"]));

        // Unfiltered, the category holds both -- which is what makes every narrowing below
        // an assertion about the filter rather than about the fixture.
        var both = await ListedIdsAsync(admin, $"/admin/question-bank?category={category}");
        Assert.Equal(2, both.Count);
        Assert.Contains(wanted.Id, both);
        Assert.Contains(other.Id, both);

        string[] narrowing =
        [
            $"?category={category}&subcategory=alpha",
            $"?category={category}&type={QuestionTypes.Likert}",
            $"?category={category}&industry=technology",
            $"?category={category}&companySize=51-200",
            $"?category={category}&tag=wanted",
        ];

        foreach (var query in narrowing)
        {
            Assert.Equal([wanted.Id], await ListedIdsAsync(admin, $"/admin/question-bank{query}"));
        }

        // The category filter itself, proved the same way: another category's question is out.
        var elsewhere = await CreateItemAsync(admin, Item(_companyId, text: "Somewhere else", category: $"{category}-other"));
        Assert.DoesNotContain(elsewhere.Id, await ListedIdsAsync(admin, $"/admin/question-bank?category={category}"));
    }

    // ------------------------------------------------------------------
    // Variations
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_variation_hangs_off_its_parent_and_inherits_its_type_category_and_targeting()
    {
        var admin = await AdminAsync();
        var parent = await CreateItemAsync(admin, new CreateQuestionBankItemRequest(
            Text: "Do you feel heard?",
            Type: QuestionTypes.Likert,
            Category: "voice",
            CompanyId: _companyId,
            Industry: "technology",
            CompanySize: "51-200",
            ScaleMin: 1,
            ScaleMax: 5));

        var created = await admin.PostAsJsonAsync(
            $"/admin/question-bank/{parent.Id}/variations",
            new CreateQuestionBankVariationRequest("Does your opinion reach the people who decide?"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var variation = (await created.Content.ReadFromJsonAsync<QuestionBankItemDetail>())!;

        Assert.Equal(parent.Id, variation.ParentQuestionBankItemId);
        Assert.Equal(parent.Type, variation.Type);
        Assert.Equal("voice", variation.Category);

        // Targeting travels with the phrasing. A variation that lost the industry and the
        // company size it was written for is a question offered to the wrong companies --
        // and it is invisible, because the variation still looks correct on its own.
        Assert.Equal("technology", variation.Industry);
        Assert.Equal("51-200", variation.CompanySize);
        Assert.Equal(parent.ScaleMin, variation.ScaleMin);
        Assert.Equal(parent.ScaleMax, variation.ScaleMax);

        // ...and the filters find it by them, which is what the inheritance is FOR.
        Assert.Contains(
            variation.Id,
            await ListedIdsAsync(admin, "/admin/question-bank?category=voice&industry=technology&companySize=51-200"));

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

    /// <summary>
    /// Bulk is not import: it writes what it is given, including two rows that say the same
    /// thing.
    /// </summary>
    /// <remarks>
    /// The two identical rows are the point. <c>SkippedAsDuplicate</c> was asserted empty on a
    /// batch of two DIFFERENT questions, where <c>BulkCreateAsync</c> passing
    /// <c>deduplicate: false</c> and a dedupe that simply found nothing are indistinguishable
    /// — an assertion that could not have failed. With a genuine collision in the batch, empty
    /// means the route really does not deduplicate, which is the difference from
    /// <c>/import</c> next door.
    /// </remarks>
    [Fact]
    public async Task A_super_admin_may_bulk_create_global_questions_and_bulk_does_not_deduplicate()
    {
        var superAdmin = await SuperAdminAsync();
        var marker = $"global-{Guid.NewGuid():N}";

        var response = await superAdmin.PostAsJsonAsync("/admin/question-bank/bulk", new BulkCreateQuestionBankItemsRequest(
        [
            Item(null, text: $"{marker} one"),
            Item(null, text: $"{marker} one"),
        ]));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<QuestionBankWriteResultResponse>())!;
        Assert.Equal(2, result.Created);
        Assert.Empty(result.SkippedAsDuplicate);
        Assert.All(result.Items, i => Assert.Null(i.CompanyId));

        var stored = await _harness.WithDbAsync(db => db.QuestionBankItems
            .CountAsync(i => i.TextEn == $"{marker} one"));
        Assert.Equal(2, stored);
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

    /// <summary>
    /// One file listing the same question twice writes it once — and the two halves of the
    /// duplicate check agree about case.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A file that lists a question twice is the ordinary case, not the exotic one, and the
    /// against-the-table half cannot see a row this same batch has not saved yet. Without the
    /// within-batch half the first run inserts both, and the SECOND run then reports the file
    /// as clean while the corpus holds the duplicate.
    /// </para>
    /// <para>
    /// The third import is the case question. The two halves used to disagree: within the
    /// batch it was case-insensitive, against the table case-sensitive under Postgres's
    /// default collation. So "Trust" and "trust" in ONE file collapsed to a row, and the same
    /// two texts imported in separate runs both landed — the same file, a different corpus,
    /// depending on how it was split.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task An_import_file_listing_the_same_question_twice_writes_it_once_whatever_the_case()
    {
        var admin = await AdminAsync();
        var marker = Guid.NewGuid().ToString("N");
        var text = $"Do you trust leadership {marker}";
        var shouted = text.ToUpperInvariant();

        Task<int> StoredAsync() => _harness.WithDbAsync(db => db.QuestionBankItems
            .CountAsync(i => i.TextEn != null && i.TextEn.ToLower() == text.ToLower()));

        var first = await admin.PostAsJsonAsync("/admin/question-bank/import", new ImportQuestionBankItemsRequest(
        [
            Item(_companyId, text: text),
            Item(_companyId, text: shouted),
        ]));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var firstResult = (await first.Content.ReadFromJsonAsync<QuestionBankWriteResultResponse>())!;
        Assert.Equal(1, firstResult.Created);
        Assert.Equal([1], firstResult.SkippedAsDuplicate);
        Assert.Equal(1, await StoredAsync());

        // The same file again adds nothing.
        var second = await admin.PostAsJsonAsync("/admin/question-bank/import", new ImportQuestionBankItemsRequest(
        [
            Item(_companyId, text: text),
            Item(_companyId, text: shouted),
        ]));
        var secondResult = (await second.Content.ReadFromJsonAsync<QuestionBankWriteResultResponse>())!;
        Assert.Equal(0, secondResult.Created);
        Assert.Equal([0, 1], secondResult.SkippedAsDuplicate);
        Assert.Equal(1, await StoredAsync());

        // ...and neither does the shouted one on its own, which is the half that used to slip
        // past the against-the-table check.
        var alone = await admin.PostAsJsonAsync(
            "/admin/question-bank/import", new ImportQuestionBankItemsRequest([Item(_companyId, text: shouted)]));
        Assert.Equal(0, (await alone.Content.ReadFromJsonAsync<QuestionBankWriteResultResponse>())!.Created);
        Assert.Equal(1, await StoredAsync());
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

        // The row survived -- asserted as a count, because the previous form
        // (Assert.NotNull over a FirstAsync) could only ever throw or pass, never fail.
        Assert.Equal(1, await _harness.WithDbAsync(db => db.QuestionBankItems.CountAsync(i => i.Id == item.Id)));

        // ...and so did the provenance the refusal exists to protect.
        Assert.Equal(
            1,
            await _harness.WithDbAsync(db => db.Questions.CountAsync(q => q.SourceQuestionBankItemId == item.Id)));
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
    /// <remarks>
    /// Both write paths. <c>POST /surveys</c> and <c>PUT /surveys/{id}</c> carry the same
    /// guard at two call sites, and only one of them was tested — so half of the rule could be
    /// deleted with every test still green, and a draft saved once legitimately and re-saved
    /// with a borrowed id would have gone through.
    /// </remarks>
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

        // The update path carries the identical guard, and it is a second call site rather
        // than the same one reached twice: a draft saved once legitimately, then re-saved
        // citing the borrowed id.
        var draft = await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Legitimate draft"),
            CompanyId: _companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions:
            [
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Our own question"), QuestionTypes.Likert, Order: 0),
            ]));

        var updated = await admin.PutAsJsonAsync($"/surveys/{draft.Id}", new UpdateSurveyRequest(
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Borrowed question"),
                    QuestionTypes.Likert,
                    Order: 0,
                    SourceQuestionBankItemId: theirs.Id),
            ]));

        Assert.Equal(HttpStatusCode.BadRequest, updated.StatusCode);

        // ...and nothing was stored: the questions are replaced wholesale on that path, so a
        // guard that ran too late would have dropped the original question as well.
        var stored = await _harness.WithDbAsync(db => db.Questions
            .AsNoTracking().Where(q => q.SurveyId == draft.Id).ToListAsync());
        Assert.Single(stored);
        Assert.Null(stored[0].SourceQuestionBankItemId);
        Assert.Equal("Our own question", stored[0].TextEn);
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

    /// <summary>
    /// Every field on the analytics response, as an exact number.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Narrowed with <c>?companyId=</c>, which is what makes it exact. Without it the scope
    /// is "my tenant plus the global corpus", and the global corpus is written by every other
    /// test in this collection — so the old form could only assert <c>&gt;=</c>, and six of the
    /// ten fields, including the only derived one, were not asserted at all.
    /// </para>
    /// <para>
    /// <c>AverageResponseRate</c> is that derived field, and the fixture is built so its value
    /// could not have come from anywhere else: two bank questions in ONE survey answered by the
    /// SAME four people, one required and one skipped by three of them, is 100 and 25 — an
    /// average of 62.5 that no count of rows produces by accident.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task Analytics_counts_the_corpus_the_caller_can_see()
    {
        var admin = await AdminAsync();
        var asked = await CreateItemAsync(admin, Item(_companyId, text: "Analytics probe", category: "analytics-probe"));
        var skipped = await CreateItemAsync(
            admin, Item(_companyId, text: "Analytics probe, skipped", category: "analytics-probe"));

        var variation = await admin.PostAsJsonAsync(
            $"/admin/question-bank/{asked.Id}/variations",
            new CreateQuestionBankVariationRequest("Analytics probe, rephrased"));
        Assert.Equal(HttpStatusCode.Created, variation.StatusCode);

        var retired = await CreateItemAsync(admin, Item(_companyId, text: "Analytics probe, retired", category: "analytics-retired"));
        await admin.PutAsJsonAsync(
            $"/admin/question-bank/{retired.Id}/lifecycle",
            new QuestionBankLifecycleRequest(QuestionBankLifecycleStates.Retired));

        var survey = await ActiveSurveyFromBankAsync(anonymous: true, asked.Id, skipped.Id);
        var askedQuestionId = survey.Questions.Single(q => q.Order == 0).Id;
        var skippedQuestionId = survey.Questions.Single(q => q.Order == 1).Id;

        for (var i = 0; i < 4; i++)
        {
            await (i == 0
                ? SubmitAsync(survey.Id, isComplete: true, (askedQuestionId, "4"), (skippedQuestionId, "3"))
                : SubmitAsync(survey.Id, isComplete: true, (askedQuestionId, "4")));
        }

        var analytics = await admin.GetFromJsonAsync<QuestionBankAnalyticsResponse>(
            $"/admin/question-bank/analytics?companyId={_companyId}");

        Assert.Equal(4, analytics!.TotalItems);
        Assert.Equal(3, analytics.ActiveItems);
        Assert.Equal(1, analytics.RetiredItems);
        Assert.Equal(0, analytics.GlobalItems);
        Assert.Equal(0, analytics.AiGeneratedItems);
        Assert.Equal(1, analytics.ItemsWithVariations);
        Assert.Equal(2, analytics.ItemsEverUsed);
        Assert.Equal(62.5d, analytics.AverageResponseRate);

        Assert.Contains(analytics.ByCategory, c => c.Category == "analytics-probe" && c.ItemCount == 3 && c.ActiveItemCount == 3);
        Assert.Contains(analytics.ByCategory, c => c.Category == "analytics-retired" && c.ItemCount == 1 && c.ActiveItemCount == 0);
        Assert.Equal([new QuestionBankTypeCount(QuestionTypes.Likert, 4)], analytics.ByType);
    }

    // ------------------------------------------------------------------
    // The tenant boundary on the DERIVED numbers
    // ------------------------------------------------------------------

    /// <summary>
    /// <b>A global question's usage is one tenant's business at a time.</b>
    /// </summary>
    /// <remarks>
    /// <para>
    /// A row with <c>company_id</c> null is readable by every tenant — that is what makes it
    /// the global corpus. Scoping the ITEM therefore scopes nothing about its USAGE, and its
    /// usage is another company's surveys: their titles, their statuses, their dates, and the
    /// exact number of completed responses they collected. Every derived number on this
    /// surface is computed inside the caller's own surveys for that reason.
    /// </para>
    /// <para>
    /// Both halves are asserted, because a fix that simply returned nothing would pass the
    /// first: company B sees zero, and company A — the tenant that actually asked the
    /// question — still sees its own survey by name.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task A_global_questions_usage_is_never_another_tenants_survey()
    {
        var marker = Guid.NewGuid().ToString("N");
        var category = $"leak-{marker}";

        var superAdmin = await SuperAdminAsync();
        var global = await CreateItemAsync(superAdmin, Item(null, text: $"Shared probe {marker}", category: category));

        var confidential = $"TENANT-A-CONFIDENTIAL-{marker}";
        var aAdmin = await AdminAsync();
        var aSurvey = await ActiveSurveyForAsync(aAdmin, _companyId, confidential, anonymous: true, global.Id);
        await SubmitAsync(aSurvey.Id, isComplete: true, (aSurvey.Questions[0].Id, "4"));

        var bAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _otherCompanyId);

        var bUsage = await bAdmin.GetFromJsonAsync<QuestionBankUsageResponse>(
            $"/admin/question-bank/usage-tracking?itemId={global.Id}");
        var bTracked = bUsage!.Items.Single();
        Assert.Equal(0, bTracked.UsageCount);
        Assert.Empty(bTracked.Surveys);
        Assert.Null(bTracked.LastUsedAt);

        var bMetrics = await bAdmin.GetFromJsonAsync<QuestionBankMetricsDto>(
            $"/admin/question-bank/{global.Id}/metrics");
        Assert.Equal(0, bMetrics!.SurveysUsedIn);
        Assert.Equal(0, bMetrics.QuestionsCreated);
        Assert.Equal(0, bMetrics.TimesAsked);
        Assert.Equal(0, bMetrics.TimesAnswered);

        var bEffectiveness = await bAdmin.GetFromJsonAsync<QuestionBankEffectivenessResponse>(
            $"/admin/question-bank/effectiveness?category={category}");
        Assert.Equal(0, bEffectiveness!.Items.Single(i => i.QuestionBankItemId == global.Id).Metrics.TimesAsked);

        var bListed = (await bAdmin.GetFromJsonAsync<QuestionBankListResponse>(
            $"/admin/question-bank?category={category}"))!.Items.Single();
        Assert.Equal(0, bListed.UsageCount);
        Assert.Null(bListed.LastUsedAt);

        var bDetail = await bAdmin.GetFromJsonAsync<QuestionBankItemDetail>($"/admin/question-bank/{global.Id}");
        Assert.Equal(0, bDetail!.UsageCount);

        // Nothing of A's reached B, by the strongest form available: the title is a string
        // nobody else could have produced, and it is nowhere in anything B was handed.
        var everythingBSaw = string.Join(
            "\n",
            await bAdmin.GetStringAsync($"/admin/question-bank/usage-tracking?itemId={global.Id}"),
            await bAdmin.GetStringAsync("/admin/question-bank/usage-tracking"),
            await bAdmin.GetStringAsync($"/admin/question-bank?category={category}"));
        Assert.DoesNotContain(confidential, everythingBSaw, StringComparison.Ordinal);
        Assert.DoesNotContain(aSurvey.Id.ToString(), everythingBSaw, StringComparison.OrdinalIgnoreCase);

        // ...and the tenant that did ask it still gets the whole answer.
        var aUsage = await aAdmin.GetFromJsonAsync<QuestionBankUsageResponse>(
            $"/admin/question-bank/usage-tracking?itemId={global.Id}");
        var aTracked = aUsage!.Items.Single();
        Assert.Equal(1, aTracked.UsageCount);
        Assert.Equal(confidential, aTracked.Surveys.Single().SurveyTitle);

        var aMetrics = await aAdmin.GetFromJsonAsync<QuestionBankMetricsDto>(
            $"/admin/question-bank/{global.Id}/metrics");
        Assert.Equal(1, aMetrics!.TimesAsked);
        Assert.Equal(1, aMetrics.TimesAnswered);

        // And the SuperAdmin, who may read every tenant already, sees the cross-tenant total.
        var everyone = await superAdmin.GetFromJsonAsync<QuestionBankMetricsDto>(
            $"/admin/question-bank/{global.Id}/metrics");
        Assert.Equal(1, everyone!.TimesAsked);
    }

    /// <summary>
    /// <b>The list and the detail report the derived numbers, not the stored snapshot.</b>
    /// </summary>
    /// <remarks>
    /// These are the two routes the admin <c>/question-bank</c> page is built on, and they
    /// were the two projecting <c>usage_count</c> / <c>response_rate</c> / <c>last_used_at</c>
    /// straight off the row — so the surface that documented "a stale snapshot can never be
    /// served as a live number" served it in the only two places a person looks. One instant,
    /// one admin, three answered responses: <c>/{id}/metrics</c> said three and the list said
    /// zero.
    /// </remarks>
    [Fact]
    public async Task The_list_and_the_detail_report_the_derived_numbers_not_the_stored_snapshot()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Derived probe", category: "derived-probe"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: true, item.Id);

        for (var i = 0; i < 3; i++)
        {
            await SubmitAsync(survey.Id, isComplete: true, (survey.Questions[0].Id, "4"));
        }

        // The stored snapshot is untouched, because nothing on the respondent path writes it.
        var row = await RowAsync(item.Id);
        Assert.Equal(0, row.UsageCount);
        Assert.Equal(0d, row.ResponseRate);
        Assert.Null(row.LastUsedAt);

        var metrics = await admin.GetFromJsonAsync<QuestionBankMetricsDto>($"/admin/question-bank/{item.Id}/metrics");
        Assert.Equal(1, metrics!.QuestionsCreated);
        Assert.Equal(3, metrics.TimesAnswered);
        Assert.Equal(100d, metrics.ResponseRate);

        // ...and the list and the detail say the same thing, rather than the row's zeroes.
        var detail = await admin.GetFromJsonAsync<QuestionBankItemDetail>($"/admin/question-bank/{item.Id}");
        Assert.Equal(1, detail!.UsageCount);
        Assert.Equal(100d, detail.ResponseRate);
        Assert.Equal(metrics.LastUsedAt, detail.LastUsedAt);

        var listed = (await admin.GetFromJsonAsync<QuestionBankListResponse>(
            "/admin/question-bank?category=derived-probe"))!.Items.Single();
        Assert.Equal(1, listed.UsageCount);
        Assert.Equal(100d, listed.ResponseRate);
        Assert.Equal(metrics.LastUsedAt, listed.LastUsedAt);
    }

    /// <summary>
    /// A <c>companyId</c> narrows a SuperAdmin's view; for a tenant it is either their own
    /// (which narrows to their private rows) or a refusal.
    /// </summary>
    /// <remarks>
    /// It used to be read for a SuperAdmin and silently dropped for everyone else, so a
    /// company_admin asking for another tenant's corpus got a 200 carrying their OWN three
    /// rows — a page that reads as somebody else's data, with every count attributed to the
    /// wrong company.
    /// </remarks>
    [Fact]
    public async Task A_company_filter_narrows_a_super_admins_view_and_is_refused_for_a_tenant()
    {
        var category = $"scope-{Guid.NewGuid():N}";
        var superAdmin = await SuperAdminAsync();

        var mine = await CreateItemAsync(superAdmin, Item(_companyId, text: "Mine", category: category));
        var theirs = await CreateItemAsync(superAdmin, Item(_otherCompanyId, text: "Theirs", category: category));
        var global = await CreateItemAsync(superAdmin, Item(null, text: "Everyone's", category: category));

        var everything = await ListedIdsAsync(superAdmin, $"/admin/question-bank?category={category}");
        Assert.Equal(3, everything.Count);

        var narrowed = await ListedIdsAsync(superAdmin, $"/admin/question-bank?companyId={_companyId}&category={category}");
        Assert.Equal([mine.Id], narrowed);

        var admin = await AdminAsync();

        // Unfiltered, a tenant sees their own plus the global corpus...
        var visible = await ListedIdsAsync(admin, $"/admin/question-bank?category={category}");
        Assert.Equal(2, visible.Count);
        Assert.Contains(mine.Id, visible);
        Assert.Contains(global.Id, visible);
        Assert.DoesNotContain(theirs.Id, visible);

        // ...and naming their own company means "mine only", which is the only other set
        // the filter can mean for them.
        Assert.Equal([mine.Id], await ListedIdsAsync(admin, $"/admin/question-bank?companyId={_companyId}&category={category}"));

        // Naming somebody else's is refused on every route that takes the filter -- never
        // answered with the caller's own rows.
        string[] filtered =
        [
            $"/admin/question-bank?companyId={_otherCompanyId}",
            $"/admin/question-bank/categories?companyId={_otherCompanyId}",
            $"/admin/question-bank/analytics?companyId={_otherCompanyId}",
            $"/admin/question-bank/effectiveness?companyId={_otherCompanyId}",
            $"/admin/question-bank/usage-tracking?companyId={_otherCompanyId}",
        ];
        foreach (var route in filtered)
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync(route)).StatusCode);
        }

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await admin.PostAsJsonAsync(
                "/admin/question-bank/effectiveness-measurement",
                new QuestionBankEffectivenessMeasurementRequest(CompanyId: _otherCompanyId))).StatusCode);
    }

    // ------------------------------------------------------------------
    // Update: the route, and what a refused one must not destroy
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_update_rewrites_the_question_replaces_its_options_and_tags_and_bumps_the_version()
    {
        var admin = await AdminAsync();
        var created = await CreateItemAsync(admin, new CreateQuestionBankItemRequest(
            Text: "Where do you work?",
            Type: QuestionTypes.MultipleChoice,
            Category: "workplace",
            CompanyId: _companyId,
            Subcategory: "setup",
            Tags: ["office", "legacy"],
            Options: [new QuestionBankOptionInput(null, "Remote"), new QuestionBankOptionInput(null, "Hybrid")]));
        Assert.Equal(1, created.Version);

        var response = await admin.PutAsJsonAsync($"/admin/question-bank/{created.Id}", new UpdateQuestionBankItemRequest(
            Text: "Where do you usually work?",
            Category: "workplace",
            Subcategory: "location",
            Industry: "technology",
            CompanySize: "51-200",
            Tags: ["location"],
            Options:
            [
                new QuestionBankOptionInput("office", "Office"),
                new QuestionBankOptionInput("remote", "Remote"),
                new QuestionBankOptionInput("hybrid", "Hybrid"),
            ]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = (await response.Content.ReadFromJsonAsync<QuestionBankItemDetail>())!;
        Assert.Equal("Where do you usually work?", updated.Text);
        Assert.Equal("location", updated.Subcategory);
        Assert.Equal("technology", updated.Industry);
        Assert.Equal("51-200", updated.CompanySize);
        Assert.Equal(["location"], updated.Tags);
        Assert.Equal(["office", "remote", "hybrid"], updated.Options.Select(o => o.Value));
        Assert.Equal(["Office", "Remote", "Hybrid"], updated.Options.Select(o => o.Label));
        Assert.Equal(2, updated.Version);

        // In the tables, not only in the response body: the option and tag rows are replaced
        // wholesale, so the ones the caller dropped are gone rather than merged.
        var stored = await RowAsync(created.Id);
        Assert.Equal("Where do you usually work?", stored.TextEn);
        Assert.Equal(2, stored.Version);

        var tags = await _harness.WithDbAsync(db => db.QuestionBankItemTags
            .Where(t => t.QuestionBankItemId == created.Id).Select(t => t.Tag).ToListAsync());
        Assert.Equal(["location"], tags);

        var values = await _harness.WithDbAsync(db => db.QuestionBankItemOptions
            .Where(o => o.QuestionBankItemId == created.Id).OrderBy(o => o.Order).Select(o => o.Value).ToListAsync());
        Assert.Equal(["office", "remote", "hybrid"], values);
    }

    /// <summary>
    /// <b>An update that is refused leaves the question exactly as it was.</b>
    /// </summary>
    /// <remarks>
    /// <para>
    /// The option rows and the tag rows are deleted before their replacements are written,
    /// and that delete used to COMMIT on its own. So a payload the database rejected — an
    /// over-long tag, nothing more exotic — returned 500 and left a <c>multiple_choice</c>
    /// question with zero options: a state the create path refuses outright, reached by
    /// failing an update.
    /// </para>
    /// <para>
    /// Two ways in, because they fail at different depths, and the second one has to fail in
    /// the right place to prove anything. A failure on the FIRST save is not evidence: the
    /// deletes and the item's own UPDATE share that save, so EF's implicit transaction undoes
    /// them together whether or not this handler opens one. The bad byte therefore goes in a
    /// TAG, which is written by the SECOND save — the only window where the deletes are
    /// already committed and the replacements are not yet written. That is the window the
    /// explicit transaction exists for, and removing it makes this test fail.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task An_update_that_is_refused_leaves_the_options_and_tags_the_question_had()
    {
        var admin = await AdminAsync();
        var created = await CreateItemAsync(admin, new CreateQuestionBankItemRequest(
            Text: "Where do you work?",
            Type: QuestionTypes.MultipleChoice,
            Category: "workplace",
            CompanyId: _companyId,
            Tags: ["office", "legacy"],
            Options: [new QuestionBankOptionInput(null, "Remote"), new QuestionBankOptionInput(null, "Hybrid")]));

        async Task AssertIntactAsync()
        {
            var options = await _harness.WithDbAsync(db => db.QuestionBankItemOptions
                .Where(o => o.QuestionBankItemId == created.Id).OrderBy(o => o.Order).Select(o => o.Value).ToListAsync());
            Assert.Equal(["Remote", "Hybrid"], options);

            var tags = await _harness.WithDbAsync(db => db.QuestionBankItemTags
                .Where(t => t.QuestionBankItemId == created.Id).OrderBy(t => t.Tag).Select(t => t.Tag).ToListAsync());
            Assert.Equal(["legacy", "office"], tags);

            var row = await RowAsync(created.Id);
            Assert.Equal("Where do you work?", row.TextEn);
            Assert.Equal(1, row.Version);
        }

        // 1. Over-long input is a 400 naming the field, not a 500 out of the insert.
        var tooLong = await admin.PutAsJsonAsync($"/admin/question-bank/{created.Id}", new UpdateQuestionBankItemRequest(
            Text: "Pick one",
            Category: "workplace",
            Tags: [new string('t', 60)],
            Options: [new QuestionBankOptionInput(null, "Remote"), new QuestionBankOptionInput(null, "Hybrid")]));
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        await AssertIntactAsync();

        // 2. ...and a failure no validation could foresee is rolled back rather than half
        // applied. A NUL byte is refused by Postgres itself, and it rides on a TAG so the
        // refusal lands on the SECOND save -- after the delete has already happened, which is
        // the only window an explicit transaction is there to cover.
        var rejectedByTheDatabase = await admin.PutAsJsonAsync(
            $"/admin/question-bank/{created.Id}",
            new UpdateQuestionBankItemRequest(
                Text: "Pick one",
                Category: "workplace",
                Tags: ["nul\u0000tag"],
                Options: [new QuestionBankOptionInput(null, "Remote"), new QuestionBankOptionInput(null, "Hybrid")]));
        Assert.NotEqual(HttpStatusCode.OK, rejectedByTheDatabase.StatusCode);
        await AssertIntactAsync();

        // 3. The question is still updatable afterwards -- the refusals left no wreckage.
        var accepted = await admin.PutAsJsonAsync($"/admin/question-bank/{created.Id}", new UpdateQuestionBankItemRequest(
            Text: "Where do you usually work?",
            Category: "workplace",
            Tags: ["office"],
            Options: [new QuestionBankOptionInput(null, "Remote"), new QuestionBankOptionInput(null, "Office")]));
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
    }

    /// <summary>
    /// Over-long input is a 400 wherever it arrives, and a batch names the row it arrived on.
    /// </summary>
    [Fact]
    public async Task Input_longer_than_its_column_is_refused_rather_than_crashing()
    {
        var admin = await AdminAsync();
        var marker = $"long-{Guid.NewGuid():N}";

        var single = await admin.PostAsJsonAsync(
            "/admin/question-bank", Item(_companyId, text: new string('x', 600)));
        Assert.Equal(HttpStatusCode.BadRequest, single.StatusCode);

        var batch = await admin.PostAsJsonAsync("/admin/question-bank/bulk", new BulkCreateQuestionBankItemsRequest(
        [
            Item(_companyId, text: $"{marker} fine"),
            Item(_companyId, text: $"{marker} also fine", tags: [new string('t', 60)]),
        ]));
        Assert.Equal(HttpStatusCode.BadRequest, batch.StatusCode);
        Assert.Contains("Item 1", await batch.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Refused whole, like every other batch failure on this surface.
        var written = await _harness.WithDbAsync(db => db.QuestionBankItems
            .CountAsync(i => i.TextEn != null && i.TextEn.StartsWith(marker)));
        Assert.Equal(0, written);
    }

    /// <summary>
    /// A <c>CompanyId</c> that names no company is a 400, not the 500 the foreign key gives.
    /// </summary>
    [Fact]
    public async Task An_unknown_company_is_refused_by_name_rather_than_by_the_foreign_key()
    {
        var superAdmin = await SuperAdminAsync();
        var ghost = Guid.NewGuid();

        var single = await superAdmin.PostAsJsonAsync("/admin/question-bank", Item(ghost, text: "Homeless question"));
        Assert.Equal(HttpStatusCode.BadRequest, single.StatusCode);
        Assert.Contains(ghost.ToString(), await single.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        var batch = await superAdmin.PostAsJsonAsync("/admin/question-bank/bulk", new BulkCreateQuestionBankItemsRequest(
        [
            Item(null, text: "A global one"),
            Item(ghost, text: "Homeless question"),
        ]));
        Assert.Equal(HttpStatusCode.BadRequest, batch.StatusCode);

        var written = await _harness.WithDbAsync(db => db.QuestionBankItems
            .CountAsync(i => i.TextEn == "Homeless question" || i.TextEn == "A global one"));
        Assert.Equal(0, written);
    }

    [Fact]
    public async Task Two_options_that_would_store_the_same_answer_are_refused()
    {
        var admin = await AdminAsync();
        var text = $"Pick one {Guid.NewGuid():N}";

        var response = await admin.PostAsJsonAsync("/admin/question-bank", new CreateQuestionBankItemRequest(
            Text: text,
            Type: QuestionTypes.MultipleChoice,
            Category: "engagement",
            CompanyId: _companyId,
            Options:
            [
                new QuestionBankOptionInput("remote", "Remote"),
                new QuestionBankOptionInput("remote", "Fully remote"),
            ]));

        // A 400 explaining it, rather than a 500 out of the unique index -- and rather than
        // two options whose answers are indistinguishable once stored.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await _harness.WithDbAsync(db => db.QuestionBankItems.CountAsync(i => i.TextEn == text)));
    }

    // ------------------------------------------------------------------
    // What the derivation counts, exactly
    // ------------------------------------------------------------------

    /// <summary>
    /// An abandoned response never reached the question, so it is not something the question
    /// was asked.
    /// </summary>
    /// <remarks>
    /// Completed-only is documented as load-bearing on <c>QuestionBankMetricsDto</c> — "a
    /// respondent who abandoned a survey on page one never saw question nine" — and every
    /// response in the suite was complete, so dropping both <c>IsComplete</c> predicates
    /// changed nothing any test could see. The partials here ANSWER the question, so removing
    /// the predicate moves the numerator and the denominator both.
    /// </remarks>
    [Fact]
    public async Task An_abandoned_response_is_not_counted_as_a_question_asked()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Partial probe", category: "partial-probe"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: true, item.Id);
        var questionId = survey.Questions[0].Id;

        await SubmitAsync(survey.Id, isComplete: true, (questionId, "4"));
        await SubmitAsync(survey.Id, isComplete: false, (questionId, "3"));
        await SubmitAsync(survey.Id, isComplete: false, (questionId, "2"));

        var metrics = await admin.GetFromJsonAsync<QuestionBankMetricsDto>($"/admin/question-bank/{item.Id}/metrics");

        Assert.Equal(1, metrics!.TimesAsked);
        Assert.Equal(1, metrics.TimesAnswered);
        Assert.Equal(100d, metrics.ResponseRate);
        Assert.Equal(0d, metrics.SkipRate);
    }

    /// <summary>
    /// A question picked twice into one survey was asked twice.
    /// </summary>
    /// <remarks>
    /// Counted per COPY rather than per survey. Collapsing to the survey looks harmless and
    /// under-counts the denominator by exactly the factor a question was reused by, which
    /// then reports a response rate above 100%.
    /// </remarks>
    [Fact]
    public async Task A_question_picked_twice_into_one_survey_is_asked_twice()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Twice probe", category: "twice-probe"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: true, item.Id, item.Id);

        var first = survey.Questions.Single(q => q.Order == 0).Id;
        var second = survey.Questions.Single(q => q.Order == 1).Id;
        await SubmitAsync(survey.Id, isComplete: true, (first, "4"), (second, "5"));
        await SubmitAsync(survey.Id, isComplete: true, (first, "3"), (second, "2"));

        var metrics = await admin.GetFromJsonAsync<QuestionBankMetricsDto>($"/admin/question-bank/{item.Id}/metrics");

        Assert.Equal(1, metrics!.SurveysUsedIn);
        Assert.Equal(2, metrics.QuestionsCreated);
        Assert.Equal(4, metrics.TimesAsked);
        Assert.Equal(4, metrics.TimesAnswered);
        Assert.Equal(100d, metrics.ResponseRate);
    }

    /// <summary>
    /// A duplicated survey is another use of the source question.
    /// </summary>
    /// <remarks>
    /// Driven through <c>POST /surveys/{id}/duplicate</c>, so the copy's provenance is
    /// written by the code that duplicates surveys in production rather than by this test.
    /// Dropping the two carried columns is invisible to every other duplication test — the
    /// copy is complete, its wording and its option values are right — and it makes the bank
    /// under-report exactly the questions that get reused most.
    /// </remarks>
    [Fact]
    public async Task Duplicating_a_survey_carries_the_bank_provenance_onto_the_copy()
    {
        var admin = await AdminAsync();
        var item = await CreateItemAsync(admin, Item(_companyId, text: "Duplication probe", category: "duplication-probe"));
        var original = await ActiveSurveyFromBankAsync(anonymous: false, item.Id);

        var response = await admin.PostAsJsonAsync($"/surveys/{original.Id}/duplicate", new DuplicateSurveyRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var copy = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;

        var copied = await _harness.WithDbAsync(db => db.Questions
            .AsNoTracking().Where(q => q.SurveyId == copy.Id).ToListAsync());
        // Single first: Assert.All over an empty list is a pass, and "the copy has no
        // questions at all" is exactly the shape a broken duplication would take.
        Assert.Single(copied);
        Assert.All(copied, q => Assert.Equal(item.Id, q.SourceQuestionBankItemId));

        // ...and the bank sees it as a second use rather than as one.
        var usage = await admin.GetFromJsonAsync<QuestionBankUsageResponse>(
            $"/admin/question-bank/usage-tracking?itemId={item.Id}");
        var tracked = usage!.Items.Single();
        Assert.Equal(2, tracked.UsageCount);
        var namedSurveys = tracked.Surveys.Select(s => s.SurveyId).ToList();
        Assert.Equal(2, namedSurveys.Count);
        Assert.Contains(original.Id, namedSurveys);
        Assert.Contains(copy.Id, namedSurveys);

        var metrics = await admin.GetFromJsonAsync<QuestionBankMetricsDto>($"/admin/question-bank/{item.Id}/metrics");
        Assert.Equal(2, metrics!.SurveysUsedIn);
        Assert.Equal(2, metrics.QuestionsCreated);
    }

    /// <summary>
    /// A measurement batch mixing a writable row with a global one is refused WHOLE.
    /// </summary>
    /// <remarks>
    /// The same rule <c>/bulk</c> and <c>/import</c> are held to, and the one place it was
    /// argued for but never tested: the existing test passes a single-element list, where
    /// "refuse the batch" and "refuse only if every row is unwritable" are indistinguishable.
    /// The writable row here has something to publish, so a batch that quietly narrowed itself
    /// would leave its snapshot behind as evidence.
    /// </remarks>
    [Fact]
    public async Task A_measurement_batch_mixing_a_global_row_with_its_own_is_refused_whole()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateItemAsync(superAdmin, Item(null, text: "Global measurement probe"));

        var admin = await AdminAsync();
        var mine = await CreateItemAsync(admin, Item(_companyId, text: "Own measurement probe", category: "mixed-probe"));
        var survey = await ActiveSurveyFromBankAsync(anonymous: true, mine.Id);
        await SubmitAsync(survey.Id, isComplete: true, (survey.Questions[0].Id, "4"));

        var response = await admin.PostAsJsonAsync(
            "/admin/question-bank/effectiveness-measurement",
            new QuestionBankEffectivenessMeasurementRequest(ItemIds: [mine.Id, global.Id]));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // Nothing was published -- not even onto the row the caller was entitled to write.
        var row = await RowAsync(mine.Id);
        Assert.Equal(0, row.UsageCount);
        Assert.Equal(0d, row.ResponseRate);
        Assert.Null(row.LastUsedAt);

        // The same batch minus the global row goes through, so the refusal above is about the
        // global row rather than about the batch being rejected for some other reason.
        var allowed = await admin.PostAsJsonAsync(
            "/admin/question-bank/effectiveness-measurement",
            new QuestionBankEffectivenessMeasurementRequest(ItemIds: [mine.Id]));
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        Assert.Equal(1, (await RowAsync(mine.Id)).UsageCount);
    }
}
