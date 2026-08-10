using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Search;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Search;

/// <summary>
/// Global search (#145) against a real Postgres.
///
/// The centre of gravity here is the tenant boundary. Two companies are seeded with
/// *deliberately identical* content -- same titles, same descriptions, same question text,
/// same department name -- so that the only thing distinguishing a correct result from a
/// leaked one is the company the row belongs to. A search that ignored the tenant predicate
/// would still return plausible-looking, correctly-ranked, correctly-localised results, and
/// that is exactly the silent failure the issue exists to prevent.
/// </summary>
[Collection("Postgres")]
public class SearchEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"srcha-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"srchb-{Guid.NewGuid():N}.test";

    private Guid _companyAId;
    private Guid _companyBId;

    /// <summary>
    /// The one word every seeded row in both companies contains. Searching it is what makes
    /// a leak visible.
    ///
    /// Unique per test instance, and that is not paranoia: xUnit constructs this class once
    /// per test, the Postgres container is shared, and nothing truncates between tests -- so
    /// a fixed word would accumulate one matching row pair per test and the cross-tenant
    /// super_admin case would start failing on the per-kind limit rather than on anything
    /// real. Hex from a Guid, so it survives tokenisation as a single lexeme.
    /// </summary>
    private readonly string _tag = $"zephyrine{Guid.NewGuid():N}";

    private sealed record Seeded(Guid SurveyId, Guid QuestionId, Guid DepartmentId, Guid ActionPlanId, Guid ReportId);

    private Seeded _a = null!;
    private Seeded _b = null!;
    private Guid _spanishSurveyA;
    private Guid _englishSurveyA;

    private Guid _surveyA => _a.SurveyId;
    private Guid _surveyB => _b.SurveyId;
    private Guid _questionA => _a.QuestionId;
    private Guid _questionB => _b.QuestionId;
    private Guid _departmentA => _a.DepartmentId;
    private Guid _departmentB => _b.DepartmentId;
    private Guid _actionPlanA => _a.ActionPlanId;
    private Guid _actionPlanB => _b.ActionPlanId;
    private Guid _reportA => _a.ReportId;
    private Guid _reportB => _b.ReportId;

    public SearchEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var now = DateTimeOffset.UtcNow;
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Search Co A", EmailDomain = _companyADomain, CreatedAt = now };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Search Co B", EmailDomain = _companyBDomain, CreatedAt = now };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;

        // Row owners. surveys.created_by, action_plans.created_by and reports.created_by are
        // all NOT NULL with a restricting foreign key.
        var ownerA = NewUser(_companyAId, $"owner-a@{_companyADomain}", $"{_tag} Owner A");
        var ownerB = NewUser(_companyBId, $"owner-b@{_companyBDomain}", $"{_tag} Owner B");
        db.Users.AddRange(ownerA, ownerB);
        await db.SaveChangesAsync();

        _a = await SeedTenantAsync(db, _companyAId, ownerA.Id, _tag);
        _b = await SeedTenantAsync(db, _companyBId, ownerB.Id, _tag);

        // Language coverage: one survey authored only in Spanish, one only in English.
        _spanishSurveyA = Guid.NewGuid();
        _englishSurveyA = Guid.NewGuid();
        db.Surveys.AddRange(
            NewSurvey(_spanishSurveyA, _companyAId, ownerA.Id, titleEn: null, titleEs: "Encuesta de Satisfacción Laboral", language: "es"),
            NewSurvey(_englishSurveyA, _companyAId, ownerA.Id, titleEn: "Workplace Satisfaction Survey", titleEs: null, language: "en"));
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Disposes the factory, unlike most classes in this assembly.
    ///
    /// xUnit constructs the class once per test case, so this one class stands up 42 hosts
    /// over its run -- several times more than any other. Each undisposed
    /// <c>WebApplicationFactory</c> keeps a running host, a service provider and its share
    /// of the Npgsql pool alive for the rest of the process, and the classes that run after
    /// this one pay for all of it. Leaving them to the GC is survivable at five tests per
    /// class and is not at forty-two. (Count is per test *case*, so a <c>[Theory]</c>
    /// contributes one host per <c>[InlineData]</c>, not one per method.)
    /// </summary>
    public Task DisposeAsync() => _factory.DisposeAsync().AsTask();

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    private static User NewUser(Guid? companyId, string email, string name, string role = Roles.Employee) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = companyId,
        Email = email,
        Name = name,
        Role = role,
        IsActive = true,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private static Survey NewSurvey(Guid id, Guid companyId, Guid createdBy, string? titleEn, string? titleEs, string language, string status = SurveyStatuses.Active) => new()
    {
        Id = id,
        CompanyId = companyId,
        CreatedBy = createdBy,
        TitleEn = titleEn,
        TitleEs = titleEs,
        Language = language,
        Type = "general_climate",
        Status = status,
        StartDate = DateTimeOffset.UtcNow.AddDays(-1),
        EndDate = DateTimeOffset.UtcNow.AddDays(30),
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private static async Task<Seeded> SeedTenantAsync(ClimateProjectDbContext db, Guid companyId, Guid ownerId, string tag)
    {
        var now = DateTimeOffset.UtcNow;

        var survey = NewSurvey(Guid.NewGuid(), companyId, ownerId, $"{tag} Engagement Pulse", $"Pulso de Compromiso {tag}", "both");
        var question = new Question
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            TextEn = $"How {tag} is your team?",
            TextEs = $"¿Qué tan {tag} es tu equipo?",
            Type = QuestionTypes.Likert,
            Order = 1,
        };
        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Name = $"{tag} Operations",
            CreatedAt = now,
            UpdatedAt = now,
        };
        var actionPlan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = ownerId,
            Title = $"{tag} onboarding overhaul",
            Description = "Rework the first week",
            DueDate = now.AddDays(30),
            CreatedAt = now,
            UpdatedAt = now,
        };
        var report = new Report
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = ownerId,
            Title = $"{tag} quarterly summary",
            Type = "summary",
            Format = "pdf",
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.Surveys.Add(survey);
        db.Questions.Add(question);
        db.Departments.Add(department);
        db.ActionPlans.Add(actionPlan);
        db.Reports.Add(report);
        await db.SaveChangesAsync();

        return new Seeded(survey.Id, question.Id, department.Id, actionPlan.Id, report.Id);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private async Task<HttpClient> ClientAsync(string role, string emailDomain, Guid? companyId)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Search Tester", email, "a-good-password"));
        Assert.True(signup.IsSuccessStatusCode, $"signup failed: {signup.StatusCode}");

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<SearchResponse> SearchAsync(HttpClient client, string query)
    {
        var response = await client.GetAsync($"/search?q={Uri.EscapeDataString(query)}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SearchResponse>())!;
    }

    private static IEnumerable<Guid> AllIds(SearchResponse response)
        => response.Groups.SelectMany(g => g.Items).Select(i => i.Id);

    private static IReadOnlyList<SearchResultItem> Group(SearchResponse response, string type)
        => response.Groups.Single(g => g.Type == type).Items;

    /// <summary>Extra company-A surveys carrying the tag, so a per-kind limit has something to cut.</summary>
    private async Task SeedExtraMatchingSurveysAsync(int count)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var owner = await db.Users.FirstAsync(u => u.Email == $"owner-a@{_companyADomain}");

        db.Surveys.AddRange(Enumerable.Range(0, count).Select(i =>
            NewSurvey(Guid.NewGuid(), _companyAId, owner.Id, $"{_tag} extra {i}", null, "en")));
        await db.SaveChangesAsync();
    }

    // ------------------------------------------------------------------
    // The tenant boundary
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_company_admin_finds_every_kind_in_their_own_tenant()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await SearchAsync(client, _tag);

        Assert.Contains(_surveyA, Group(results, SearchEntityTypes.Survey).Select(i => i.Id));
        Assert.Contains(_questionA, Group(results, SearchEntityTypes.Question).Select(i => i.Id));
        Assert.Contains(_departmentA, Group(results, SearchEntityTypes.Department).Select(i => i.Id));
        Assert.Contains(_actionPlanA, Group(results, SearchEntityTypes.ActionPlan).Select(i => i.Id));
        Assert.Contains(_reportA, Group(results, SearchEntityTypes.Report).Select(i => i.Id));
        Assert.NotEmpty(Group(results, SearchEntityTypes.User));
    }

    [Theory]
    [InlineData(Roles.CompanyAdmin)]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task No_role_below_super_admin_gets_a_single_row_from_another_tenant(string role)
    {
        // Company B is seeded with byte-identical content, so every one of these ids would
        // come back looking entirely legitimate if the tenant predicate were missing.
        var foreignIds = new[] { _surveyB, _questionB, _departmentB, _actionPlanB, _reportB };

        var client = await ClientAsync(role, _companyADomain, _companyAId);

        var results = await SearchAsync(client, _tag);

        var returned = AllIds(results).ToHashSet();
        Assert.All(foreignIds, id => Assert.DoesNotContain(id, returned));
    }

    [Fact]
    public async Task A_company_admin_cannot_widen_the_search_by_naming_another_company()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/search?q={_tag}&companyId={_companyBId}");

        // A 403 rather than an empty 200: the caller asserted a company that is not theirs,
        // and answering "no results" would hide the fact that the assertion was rejected.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_employee_cannot_widen_the_search_by_naming_another_company()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/search?q={_tag}&companyId={_companyBId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// The rejection must not depend on the search term.
    ///
    /// The blank-term short-circuit used to run before the access check, so
    /// <c>?q=&amp;companyId=&lt;foreign&gt;</c> answered 200 with an empty body while
    /// <c>?q=abc&amp;companyId=&lt;foreign&gt;</c> answered 403 -- the same probe, two
    /// answers, and the quiet one is the lie ResolveAccessAsync's doc comment forbids. Note
    /// what makes this a regression test rather than a duplicate: it is the *empty* term
    /// that is load-bearing, and every value here is one a type-ahead sends unprompted on a
    /// cleared box.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("...")]
    public async Task A_foreign_company_is_rejected_even_when_the_query_is_empty(string q)
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var search = await client.GetAsync($"/search?q={Uri.EscapeDataString(q)}&companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, search.StatusCode);

        var suggestions = await client.GetAsync($"/search/suggestions?q={Uri.EscapeDataString(q)}&companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, suggestions.StatusCode);
    }

    /// <summary>
    /// The other half of the same rule: an empty term against a company that *is* yours is
    /// still an ordinary empty 200, not a 403. Without this, moving the access check earlier
    /// could be "fixed" by rejecting every blank keystroke, which would be worse.
    /// </summary>
    [Fact]
    public async Task An_empty_query_against_your_own_company_is_an_empty_two_hundred()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/search?q=&companyId={_companyAId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SearchResponse>();
        Assert.Equal(0, body!.TotalCount);
        Assert.All(body.Groups, g => Assert.Empty(g.Items));
    }

    [Fact]
    public async Task Search_requires_authentication()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync($"/search?q={_tag}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_super_admin_sees_both_tenants_and_can_narrow_to_one()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain, companyId: null);

        var everything = await SearchAsync(client, _tag);
        var surveyIds = Group(everything, SearchEntityTypes.Survey).Select(i => i.Id).ToList();
        Assert.Contains(_surveyA, surveyIds);
        Assert.Contains(_surveyB, surveyIds);

        var narrowed = await client.GetFromJsonAsync<SearchResponse>($"/search?q={_tag}&companyId={_companyAId}");
        var narrowedIds = Group(narrowed!, SearchEntityTypes.Survey).Select(i => i.Id).ToList();
        Assert.Contains(_surveyA, narrowedIds);
        Assert.DoesNotContain(_surveyB, narrowedIds);
    }

    [Fact]
    public async Task Every_hit_reports_the_tenant_it_came_from()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await SearchAsync(client, _tag);

        Assert.All(results.Groups.SelectMany(g => g.Items), item => Assert.Equal(_companyAId, item.CompanyId));
    }

    // ------------------------------------------------------------------
    // Non-admin roles see only what their own listing endpoint shows them
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_employee_finds_a_survey_they_are_expected_to_answer()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId);

        var results = await SearchAsync(client, _tag);

        Assert.Contains(_surveyA, Group(results, SearchEntityTypes.Survey).Select(i => i.Id));
    }

    [Fact]
    public async Task An_employee_finds_nothing_they_have_no_listing_endpoint_for()
    {
        // Departments, users, action plans, reports and question banks are admin-only reads
        // (see the CanAccessCompany guards). Search must not be the first surface that
        // exposes them -- if that changes, it changes in those endpoints first.
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId);

        var results = await SearchAsync(client, _tag);

        Assert.Empty(Group(results, SearchEntityTypes.Department));
        Assert.Empty(Group(results, SearchEntityTypes.User));
        Assert.Empty(Group(results, SearchEntityTypes.ActionPlan));
        Assert.Empty(Group(results, SearchEntityTypes.Report));
        Assert.Empty(Group(results, SearchEntityTypes.Question));
    }

    [Fact]
    public async Task An_employee_does_not_find_a_draft_survey_they_are_not_expected_to_answer()
    {
        var draftId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var owner = await db.Users.FirstAsync(u => u.Email == $"owner-a@{_companyADomain}");
            db.Surveys.Add(NewSurvey(draftId, _companyAId, owner.Id, $"{_tag} unpublished draft", null, "en", SurveyStatuses.Draft));
            await db.SaveChangesAsync();
        }

        var employee = await ClientAsync(Roles.Employee, _companyADomain, _companyAId);
        var admin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        Assert.DoesNotContain(draftId, Group(await SearchAsync(employee, _tag), SearchEntityTypes.Survey).Select(i => i.Id));
        Assert.Contains(draftId, Group(await SearchAsync(admin, _tag), SearchEntityTypes.Survey).Select(i => i.Id));
    }

    // ------------------------------------------------------------------
    // Bilingual content
    // ------------------------------------------------------------------

    [Fact]
    public async Task Spanish_only_content_is_found_by_its_spanish_words()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await SearchAsync(client, "satisfacción");

        Assert.Contains(_spanishSurveyA, Group(results, SearchEntityTypes.Survey).Select(i => i.Id));
    }

    [Fact]
    public async Task English_only_content_is_found_by_its_english_words()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await SearchAsync(client, "workplace");

        Assert.Contains(_englishSurveyA, Group(results, SearchEntityTypes.Survey).Select(i => i.Id));
    }

    [Fact]
    public async Task A_bilingual_survey_is_found_from_either_language()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        Assert.Contains(_surveyA, Group(await SearchAsync(client, "engagement"), SearchEntityTypes.Survey).Select(i => i.Id));
        Assert.Contains(_surveyA, Group(await SearchAsync(client, "compromiso"), SearchEntityTypes.Survey).Select(i => i.Id));
    }

    [Fact]
    public async Task A_hit_is_titled_in_the_requested_locale()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var spanish = await client.GetFromJsonAsync<SearchResponse>($"/search?q=engagement&lang=es&types=survey");
        var english = await client.GetFromJsonAsync<SearchResponse>($"/search?q=engagement&lang=en&types=survey");

        Assert.Equal($"Pulso de Compromiso {_tag}", Group(spanish!, SearchEntityTypes.Survey).Single(i => i.Id == _surveyA).Title);
        Assert.Equal($"{_tag} Engagement Pulse", Group(english!, SearchEntityTypes.Survey).Single(i => i.Id == _surveyA).Title);
    }

    [Fact]
    public async Task A_spanish_only_survey_keeps_its_spanish_title_for_an_english_reader()
    {
        // #78's rule for authored content: fall back to the language it was written in
        // rather than rendering nothing or a key path.
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await client.GetFromJsonAsync<SearchResponse>("/search?q=satisfacción&lang=en&types=survey");

        Assert.Equal(
            "Encuesta de Satisfacción Laboral",
            Group(results!, SearchEntityTypes.Survey).Single(i => i.Id == _spanishSurveyA).Title);
    }

    // ------------------------------------------------------------------
    // Query handling
    // ------------------------------------------------------------------

    [Theory]
    [InlineData("engag")]
    [InlineData("compromi")]
    [InlineData("zephyr")]
    public async Task A_half_typed_word_matches_by_prefix(string prefix)
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await SearchAsync(client, prefix);

        Assert.Contains(_surveyA, Group(results, SearchEntityTypes.Survey).Select(i => i.Id));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("!!!")]
    public async Task An_empty_term_returns_nothing_rather_than_the_whole_tenant(string query)
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await SearchAsync(client, query);

        Assert.Equal(0, results.TotalCount);
        Assert.All(results.Groups, g => Assert.Empty(g.Items));
    }

    [Theory]
    // Every one of these makes to_tsquery raise a syntax error if it reaches the database.
    [InlineData("q&a")]
    [InlineData("(draft")]
    [InlineData("engagement |")]
    [InlineData("zephyrine <-> pulse")]
    [InlineData("zephyrine:*)")]
    public async Task Punctuation_a_human_types_never_reaches_to_tsquery(string query)
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/search?q={Uri.EscapeDataString(query)}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_entity_kind_is_rejected_rather_than_silently_ignored()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/search?q={_tag}&types=survey,response");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task The_types_filter_narrows_the_groups_returned()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await client.GetFromJsonAsync<SearchResponse>($"/search?q={_tag}&types=report,department");

        Assert.Equal(["department", "report"], results!.Groups.Select(g => g.Type));
    }

    [Fact]
    public async Task The_limit_is_per_kind_and_capped()
    {
        await SeedExtraMatchingSurveysAsync(4);
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var unlimited = await client.GetFromJsonAsync<SearchResponse>($"/search?q={_tag}&types=survey");
        var limited = await client.GetFromJsonAsync<SearchResponse>($"/search?q={_tag}&types=survey&limit=2");

        // The unlimited call is what makes the limited one mean something: without it, a
        // limit of 2 over a single matching row would pass no matter what the limit did.
        Assert.Equal(5, Group(unlimited!, SearchEntityTypes.Survey).Count);
        Assert.Equal(2, Group(limited!, SearchEntityTypes.Survey).Count);
    }

    [Fact]
    public async Task A_caller_cannot_raise_the_per_kind_limit_above_the_cap()
    {
        // The other half of the test above, which asserts "capped" in its name but only ever
        // proves "limited": with five matching rows, a request for a thousand and a request
        // for twenty-five are indistinguishable. Thirty matching surveys is the smallest
        // seed that can tell an enforced cap from an ignored one.
        await SeedExtraMatchingSurveysAsync(29);
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var overCap = await client.GetFromJsonAsync<SearchResponse>($"/search?q={_tag}&types=survey&limit=1000");

        Assert.Equal(25, Group(overCap!, SearchEntityTypes.Survey).Count);
    }

    [Fact]
    public async Task TotalCount_counts_what_was_returned_and_not_what_matched()
    {
        await SeedExtraMatchingSurveysAsync(4);
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var results = await client.GetFromJsonAsync<SearchResponse>($"/search?q={_tag}&types=survey&limit=1");

        // A match count computed without the limit -- or worse, without the tenant filter --
        // is an oracle telling a tenant how much its neighbours have.
        Assert.Equal(1, results!.TotalCount);
    }

    // ------------------------------------------------------------------
    // Suggestions
    // ------------------------------------------------------------------

    [Fact]
    public async Task Suggestions_mix_the_kinds_rather_than_letting_one_fill_the_palette()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var suggestions = await client.GetFromJsonAsync<SearchSuggestionsResponse>($"/search/suggestions?q={_tag}");

        Assert.NotEmpty(suggestions!.Suggestions);
        Assert.True(suggestions.Suggestions.Select(s => s.Type).Distinct().Count() > 1);
        Assert.All(suggestions.Suggestions, s => Assert.False(string.IsNullOrWhiteSpace(s.Title)));
    }

    [Fact]
    public async Task Suggestions_respect_the_tenant_boundary_too()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var suggestions = await client.GetFromJsonAsync<SearchSuggestionsResponse>($"/search/suggestions?q={_tag}&limit=25");

        var returned = suggestions!.Suggestions.Select(s => s.Id).ToHashSet();
        Assert.All([_surveyB, _questionB, _departmentB, _actionPlanB, _reportB], id => Assert.DoesNotContain(id, returned));
    }

    [Fact]
    public async Task Suggestions_are_capped_by_the_requested_limit()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var suggestions = await client.GetFromJsonAsync<SearchSuggestionsResponse>($"/search/suggestions?q={_tag}&limit=2");

        Assert.Equal(2, suggestions!.Suggestions.Count);
    }

    // ------------------------------------------------------------------
    // Type-ahead latency at a realistic row count
    // ------------------------------------------------------------------

    [Fact]
    public async Task Type_ahead_uses_the_gin_index_at_a_realistic_row_count()
    {
        const int rows = 2_000;
        var bulk = Enumerable.Range(0, rows)
            .Select(i => (Id: Guid.NewGuid(), Title: $"Quarterly climate review cohortx{i} team {i % 37}"))
            .ToList();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var owner = await db.Users.FirstAsync(u => u.Email == $"owner-a@{_companyADomain}");

            // Varied text, so the lexeme vocabulary is realistic rather than 2,000 copies
            // of one word -- a single-lexeme index would make any plan look good.
            db.Surveys.AddRange(bulk.Select(row => NewSurvey(row.Id, _companyAId, owner.Id, row.Title, null, "en")));
            await db.SaveChangesAsync();
            await db.Database.ExecuteSqlRawAsync("ANALYZE surveys");

            var indexes = await ScalarLinesAsync(db, "SELECT indexdef FROM pg_indexes WHERE tablename = 'surveys'");
            Assert.Contains("IX_surveys_search_vector", indexes, StringComparison.Ordinal);
            Assert.Contains("USING gin", indexes, StringComparison.Ordinal);

            var plan = await ExplainAsync(db, "cohortx1500:*");
            Assert.Contains("IX_surveys_search_vector", plan, StringComparison.Ordinal);
        }

        try
        {
            // The plan assertion is the real evidence -- a wall-clock bound on a laptop-hosted
            // container proves very little on its own. This is only here to catch an order-of-
            // magnitude regression, so the budget is deliberately loose.
            var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
            await client.GetAsync("/search/suggestions?q=warmup");

            var stopwatch = Stopwatch.StartNew();
            var response = await client.GetAsync("/search/suggestions?q=cohort");
            stopwatch.Stop();

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.True(stopwatch.ElapsedMilliseconds < 1_000, $"type-ahead took {stopwatch.ElapsedMilliseconds}ms over {rows} rows");
        }
        finally
        {
            // Every integration class in this assembly shares one Postgres and nothing
            // truncates between them, so 2,000 surveys left behind here are 2,000 surveys
            // every later class pays for. Cleaned up in a finally so a failed assertion
            // above does not turn one red test into a slow suite.
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var ids = bulk.Select(row => row.Id).ToArray();
            await db.Surveys.Where(s => ids.Contains(s.Id)).ExecuteDeleteAsync();
            await db.Database.ExecuteSqlRawAsync("ANALYZE surveys");
        }
    }

    /// <summary>
    /// EXPLAIN of the exact predicate the endpoint issues, with sequential scans priced out
    /// of the running.
    ///
    /// Turning off enable_seqscan is the honest form of this assertion rather than a way of
    /// forcing the answer. What has to be proved is that the index is *usable* for this
    /// predicate -- the way this goes silently wrong is a mismatch between the text-search
    /// configuration the vector was built with and the one to_tsquery parses in, which makes
    /// the index inapplicable and leaves a full scan as the only plan. Which plan Postgres
    /// *prefers* over two thousand rows in a laptop container says nothing about what it
    /// will prefer in production, so asserting on the preference would test the planner's
    /// cost model rather than this feature.
    ///
    /// SET LOCAL inside a transaction that is always rolled back, never a bare SET. A bare
    /// SET lives for the rest of the session, and this connection goes back into the pool
    /// the whole application shares -- a stray enable_seqscan=off leaking out of here would
    /// hand some later, unrelated test a catastrophic plan and a failure with no visible
    /// cause.
    /// </summary>
    private static async Task<string> ExplainAsync(ClimateProjectDbContext db, string tsQuery)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        try
        {
            await db.Database.ExecuteSqlRawAsync("SET LOCAL enable_seqscan = off");
            return await ScalarLinesAsync(
                db,
                """EXPLAIN SELECT "Id" FROM surveys WHERE search_vector @@ to_tsquery('simple', @q) LIMIT 8""",
                tsQuery);
        }
        finally
        {
            await transaction.RollbackAsync();
        }
    }

    private static async Task<string> ScalarLinesAsync(ClimateProjectDbContext db, string sql, string? tsQuery = null)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync();
        }

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        if (tsQuery is not null)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = "q";
            parameter.Value = tsQuery;
            command.Parameters.Add(parameter);
        }

        var lines = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            lines.Add(reader.GetString(0));
        }

        return string.Join('\n', lines);
    }
}
