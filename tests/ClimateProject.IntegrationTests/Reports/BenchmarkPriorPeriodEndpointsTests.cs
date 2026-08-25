using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

/// <summary>
/// Prior-period linkage: the thing that makes a year-over-year benchmark reading exist at all
/// (#89).
///
/// <para>
/// Every fixture here is built through the routes a real administrator uses -- POST
/// /admin/benchmarks, POST .../metrics, PUT .../prior-period -- and never by inserting rows.
/// That is deliberate and it is the point of the file: the defect #89 describes is that
/// nothing in the product could ever WRITE a link, so a test that hand-writes one asserts the
/// arithmetic over a payload no producer can currently produce, and would have passed just as
/// happily before this change. The one place a row is written directly is the check-constraint
/// test, whose whole subject is what happens when something bypasses the handlers.
/// </para>
/// </summary>
[Collection("Postgres")]
public class BenchmarkPriorPeriodEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"prior-a-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"prior-b-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public BenchmarkPriorPeriodEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Prior Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Prior Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> ClientAsync(string role, string emailDomain, Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue) user.CompanyId = companyId.Value;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<BenchmarkDetail> CreateAsync(
        HttpClient client, string name, Guid? companyId, string category = "engagement", string type = "industry")
    {
        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            name, "d", type, category, "internal", null, null, null, companyId, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BenchmarkDetail>())!;
    }

    private static async Task<BenchmarkDetail> AddMetricAsync(
        HttpClient client, Guid benchmarkId, string metricName, double value, string unit)
    {
        var response = await client.PostAsJsonAsync(
            $"/admin/benchmarks/{benchmarkId}/metrics",
            new AddBenchmarkMetricRequest(metricName, value, unit, null, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BenchmarkDetail>())!;
    }

    private static Task<HttpResponseMessage> SetPriorPeriodAsync(HttpClient client, Guid id, string status, Guid? priorId = null)
        => client.PutAsJsonAsync($"/admin/benchmarks/{id}/prior-period", new SetPriorPeriodRequest(status, priorId));

    private static async Task<BenchmarkDetail> GetAsync(HttpClient client, Guid id)
    {
        var response = await client.GetAsync($"/admin/benchmarks/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BenchmarkDetail>())!;
    }

    /// <summary>
    /// The headline acceptance criterion: a real year-over-year number where a prior period
    /// exists.
    ///
    /// <para>
    /// Two benchmarks, each given its own metric reading through the metrics route, linked
    /// through the prior-period route, then read back through the ordinary detail route. The
    /// assertion is on the rendered figures -- 74 against 70, a delta of 4 and a change ratio
    /// of 4/70 -- and not on "PriorPeriod is not null", because the field being present and
    /// the field being right are different claims and only the second one is the feature.
    /// </para>
    /// <para>
    /// Also asserts the linkage is established AFTER both benchmarks exist. That is the whole
    /// gap: before this change PriorPeriodBenchmarkId could only be supplied at create time,
    /// so every benchmark already in a database was unlinkable for good.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_linked_benchmark_reports_the_prior_periods_value_and_the_change_against_it()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var prior = await CreateAsync(client, "2025 Engagement", _companyAId);
        await AddMetricAsync(client, prior.Id, "engagement_score", 70, "percent");

        var current = await CreateAsync(client, "2026 Engagement", _companyAId);
        await AddMetricAsync(client, current.Id, "engagement_score", 74, "percent");

        var beforeLinking = await GetAsync(client, current.Id);
        Assert.Equal(PriorPeriodStatuses.Unlinked, beforeLinking.PriorPeriodStatus);
        Assert.Null(beforeLinking.PriorPeriod);

        var link = await SetPriorPeriodAsync(client, current.Id, PriorPeriodStatuses.Linked, prior.Id);
        Assert.Equal(HttpStatusCode.OK, link.StatusCode);

        var linked = await GetAsync(client, current.Id);
        Assert.Equal(PriorPeriodStatuses.Linked, linked.PriorPeriodStatus);
        Assert.Equal(prior.Id, linked.PriorPeriodBenchmarkId);
        Assert.Equal(prior.Id, linked.PriorPeriod!.Id);
        Assert.Equal("2025 Engagement", linked.PriorPeriod.Name);

        var change = Assert.Single(linked.PriorPeriod.Metrics);
        Assert.Equal("engagement_score", change.MetricName);
        Assert.Equal(74d, change.Value!.Value);
        Assert.Equal(70d, change.PriorValue!.Value);
        Assert.Equal(4d, change.Delta!.Value);
        Assert.Equal(4d / 70d, change.ChangeRatio!.Value, 10);
    }

    /// <summary>
    /// "No prior period" and "not linked yet" are different answers and the API says which.
    ///
    /// <para>
    /// Two benchmarks in the same state as far as the pointer is concerned -- both null --
    /// and the response tells them apart. This is the criterion the browser cannot satisfy on
    /// its own: before this column existed, <c>priorPeriodBenchmarkId === null</c> was every
    /// bit of evidence the page had, and it printed one sentence over a first-year company
    /// and over a data-entry backlog alike.
    /// </para>
    /// </summary>
    [Fact]
    public async Task No_prior_period_and_not_yet_linked_are_different_answers()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var firstEver = await CreateAsync(client, "2026 First Measurement", _companyAId);
        var notGotRoundToIt = await CreateAsync(client, "2026 Backlog", _companyAId, category: "wellbeing");

        var declared = await SetPriorPeriodAsync(client, firstEver.Id, PriorPeriodStatuses.None);
        Assert.Equal(HttpStatusCode.OK, declared.StatusCode);

        var declaredDetail = await GetAsync(client, firstEver.Id);
        var untouchedDetail = await GetAsync(client, notGotRoundToIt.Id);

        Assert.Null(declaredDetail.PriorPeriodBenchmarkId);
        Assert.Null(untouchedDetail.PriorPeriodBenchmarkId);
        Assert.NotEqual(declaredDetail.PriorPeriodStatus, untouchedDetail.PriorPeriodStatus);
        Assert.Equal(PriorPeriodStatuses.None, declaredDetail.PriorPeriodStatus);
        Assert.Equal(PriorPeriodStatuses.Unlinked, untouchedDetail.PriorPeriodStatus);

        // And the list projection carries it too, so a catalogue does not have to fetch every
        // detail to know which rows are still waiting on an answer.
        var list = await client.GetAsync($"/admin/benchmarks?companyId={_companyAId}");
        var items = (await list.Content.ReadFromJsonAsync<List<BenchmarkListItem>>())!;
        Assert.Equal(PriorPeriodStatuses.None, items.Single(i => i.Id == firstEver.Id).PriorPeriodStatus);
        Assert.Equal(PriorPeriodStatuses.Unlinked, items.Single(i => i.Id == notGotRoundToIt.Id).PriorPeriodStatus);
    }

    /// <summary>
    /// Declaring "no prior period" clears a link that was there, and says so.
    /// </summary>
    [Fact]
    public async Task Declaring_no_prior_period_clears_an_existing_link()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var prior = await CreateAsync(client, "2025", _companyAId);
        var current = await CreateAsync(client, "2026", _companyAId);
        Assert.Equal(HttpStatusCode.OK, (await SetPriorPeriodAsync(client, current.Id, PriorPeriodStatuses.Linked, prior.Id)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await SetPriorPeriodAsync(client, current.Id, PriorPeriodStatuses.None)).StatusCode);

        var detail = await GetAsync(client, current.Id);
        Assert.Equal(PriorPeriodStatuses.None, detail.PriorPeriodStatus);
        Assert.Null(detail.PriorPeriodBenchmarkId);
        Assert.Null(detail.PriorPeriod);
    }

    /// <summary>
    /// A change is withheld rather than invented when the two periods disagree about units.
    ///
    /// <para>
    /// <c>BenchmarkMetric.Unit</c> is a free string, so the same metric can be recorded in
    /// <c>percent</c> one year and <c>points</c> the next. 0.74 differenced against 70 is a
    /// 69-point collapse that never happened -- a confidently wrong comparison, which is the
    /// exact failure #89 exists to avoid. Both values and both units still come back, so a
    /// caller can explain the gap rather than print a dash.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_change_is_not_computed_across_two_different_units()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var prior = await CreateAsync(client, "2025 Units", _companyAId);
        await AddMetricAsync(client, prior.Id, "engagement_score", 70, "percent");
        var current = await CreateAsync(client, "2026 Units", _companyAId);
        await AddMetricAsync(client, current.Id, "engagement_score", 0.74, "fraction");
        Assert.Equal(HttpStatusCode.OK, (await SetPriorPeriodAsync(client, current.Id, PriorPeriodStatuses.Linked, prior.Id)).StatusCode);

        var change = Assert.Single((await GetAsync(client, current.Id)).PriorPeriod!.Metrics);
        Assert.Equal(0.74d, change.Value!.Value);
        Assert.Equal("fraction", change.Unit);
        Assert.Equal(70d, change.PriorValue!.Value);
        Assert.Equal("percent", change.PriorUnit);
        Assert.Null(change.Delta);
        Assert.Null(change.ChangeRatio);
    }

    /// <summary>
    /// A prior period must be the same company's, in the same category, of the same type.
    ///
    /// <para>
    /// The cross-tenant row is the one that matters most: a CompanyAdmin who could point at
    /// company B's benchmark would read B's movement out of A's detail response. The global
    /// case is refused for the same reason in reverse -- a global row is visible to every
    /// tenant, and calling it "last year" turns an industry comparison into a year-over-year
    /// one.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_prior_period_must_share_the_benchmarks_scope_category_and_type()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var otherTenant = await CreateAsync(superAdmin, "Company B 2025", _companyBId);
        var global = await CreateAsync(superAdmin, $"Global 2025 {Guid.NewGuid():N}", null);

        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var otherCategory = await CreateAsync(client, "2025 Wellbeing", _companyAId, category: "wellbeing");
        var otherType = await CreateAsync(client, "2025 Internal", _companyAId, type: "internal");
        var subject = await CreateAsync(client, "2026 Engagement", _companyAId);

        foreach (var rejected in new[] { otherTenant.Id, global.Id, otherCategory.Id, otherType.Id })
        {
            var response = await SetPriorPeriodAsync(client, subject.Id, PriorPeriodStatuses.Linked, rejected);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        var detail = await GetAsync(client, subject.Id);
        Assert.Equal(PriorPeriodStatuses.Unlinked, detail.PriorPeriodStatus);
        Assert.Null(detail.PriorPeriodBenchmarkId);
    }

    /// <summary>
    /// The same rules apply to a link supplied at create time.
    ///
    /// <para>
    /// Create used to check only that the id existed, so the whole scope-and-category rule
    /// could be walked round by supplying the link with the benchmark instead of after it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Create_refuses_a_prior_period_from_another_tenant()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var otherTenant = await CreateAsync(superAdmin, "Company B 2025 create", _companyBId);

        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            "2026 Engagement", "d", "industry", "engagement", "internal", null, null, null, _companyAId, otherTenant.Id));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// A period cannot precede itself, directly or round a loop.
    ///
    /// <para>
    /// Nothing refused this before: the browser carried a visited set in
    /// <c>followPriorPeriodChain</c> precisely because A-&gt;B-&gt;A was creatable and would
    /// otherwise hang the benchmarks page. Refusing it on the write path is what makes that
    /// guard a belt rather than the only thing holding the trousers up.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_link_that_would_close_a_loop_is_refused()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var a = await CreateAsync(client, "A", _companyAId);
        var b = await CreateAsync(client, "B", _companyAId);
        var c = await CreateAsync(client, "C", _companyAId);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await SetPriorPeriodAsync(client, a.Id, PriorPeriodStatuses.Linked, a.Id)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await SetPriorPeriodAsync(client, c.Id, PriorPeriodStatuses.Linked, b.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SetPriorPeriodAsync(client, b.Id, PriorPeriodStatuses.Linked, a.Id)).StatusCode);

        // c -> b -> a, so a -> c would close the loop.
        Assert.Equal(HttpStatusCode.BadRequest,
            (await SetPriorPeriodAsync(client, a.Id, PriorPeriodStatuses.Linked, c.Id)).StatusCode);
    }

    /// <summary>
    /// 'linked' without a pointer, the pointerless statuses WITH one, and a status that is
    /// not one of the three, are all refused. The status and the pointer are one fact, and a
    /// request that states it twice differently is not a request the handler gets to guess
    /// at.
    /// </summary>
    [Theory]
    [InlineData("linked", false)]
    [InlineData("none", true)]
    [InlineData("unlinked", true)]
    [InlineData("nonsense", false)]
    [InlineData("nonsense", true)]
    public async Task The_status_and_the_pointer_have_to_agree(string status, bool sendPointer)
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var prior = await CreateAsync(client, "prior", _companyAId);
        var subject = await CreateAsync(client, "subject", _companyAId);

        var response = await SetPriorPeriodAsync(client, subject.Id, status, sendPointer ? prior.Id : null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(PriorPeriodStatuses.Unlinked, (await GetAsync(client, subject.Id)).PriorPeriodStatus);
    }

    /// <summary>
    /// The database will not hold a status and a pointer that disagree, whatever writes them.
    ///
    /// <para>
    /// Written straight through the DbContext, bypassing every handler, because that is the
    /// scenario: #90 adds bulk and import paths, a seed script writes rows, a support fix
    /// runs an UPDATE. Any of those can set an id and forget the status. The CHECK constraint
    /// is the reason none of them can leave a benchmark whose page says "not linked yet" over
    /// a real comparison.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_database_refuses_a_status_that_contradicts_the_pointer()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var prior = await CreateAsync(client, "constraint prior", _companyAId);
        var subject = await CreateAsync(client, "constraint subject", _companyAId);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var pointerWithoutStatus = await db.Benchmarks.FirstAsync(b => b.Id == subject.Id);
        pointerWithoutStatus.PriorPeriodBenchmarkId = prior.Id;
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());

        db.ChangeTracker.Clear();

        var statusWithoutPointer = await db.Benchmarks.FirstAsync(b => b.Id == subject.Id);
        statusWithoutPointer.PriorPeriodStatus = PriorPeriodStatuses.Linked;
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    /// <summary>
    /// Candidates are suggested, ranked newest first, and flagged as unambiguous only when
    /// there is exactly one.
    /// </summary>
    [Fact]
    public async Task Candidates_are_the_earlier_benchmarks_of_the_same_scope_category_and_type()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var older = await CreateAsync(client, "2024 Engagement", _companyAId);
        var wrongCategory = await CreateAsync(client, "2024 Wellbeing", _companyAId, category: "wellbeing");
        // Same company, same category, earlier -- and a different KIND of benchmark. An
        // `internal` row is this company's own measurement and an `industry` row is a market
        // reading; differencing one against the other is not a year-over-year change, it is
        // two populations subtracted. Type is also the only condition standing between the
        // ?apply=true backfill and doing exactly that unattended, which is why the case is
        // here rather than left to the name of the test.
        var wrongType = await CreateAsync(client, "2024 Engagement (internal)", _companyAId, type: "internal");
        var subject = await CreateAsync(client, "2026 Engagement", _companyAId);

        var single = await client.GetAsync($"/admin/benchmarks/{subject.Id}/prior-period/candidates");
        Assert.Equal(HttpStatusCode.OK, single.StatusCode);
        // Single, so neither the wellbeing benchmark nor the internal one created between the
        // two is a candidate: a prior period has to measure the same thing, the same way.
        var only = Assert.Single((await single.Content.ReadFromJsonAsync<List<PriorPeriodCandidateDto>>())!);
        Assert.Equal(older.Id, only.Id);
        Assert.NotEqual(wrongCategory.Id, only.Id);
        Assert.NotEqual(wrongType.Id, only.Id);
        Assert.True(only.Unambiguous);

        // A second same-category benchmark makes the choice a judgement call, and the flag
        // says so on every row rather than on the runner-up.
        var alsoOlder = await CreateAsync(client, "2025 Engagement", _companyAId);
        var laterSubject = await CreateAsync(client, "2027 Engagement", _companyAId);

        var many = await client.GetAsync($"/admin/benchmarks/{laterSubject.Id}/prior-period/candidates");
        var candidates = (await many.Content.ReadFromJsonAsync<List<PriorPeriodCandidateDto>>())!;
        Assert.All(candidates, c => Assert.False(c.Unambiguous));
        Assert.DoesNotContain(candidates, c => c.Id == wrongCategory.Id || c.Id == wrongType.Id);
        // Newest first, so the most plausible prior period is the one a reader sees first.
        Assert.Equal(new[] { alsoOlder.Id, subject.Id, older.Id }, candidates.Select(c => c.Id).ToArray());
    }

    /// <summary>
    /// A benchmark somebody has taken out of use is not offered as the thing this year is
    /// measured against.
    ///
    /// <para>
    /// The consequence is asserted, not just the shortlist: with the retired row still in it
    /// the subject has two candidates instead of one, which is the difference between a
    /// backfill that links it and a backfill that declares the choice ambiguous and walks
    /// away. Deactivating last year's benchmark would silently stop this year's from being
    /// linked at all.
    /// </para>
    /// <para>
    /// <b>The one fixture here that a route cannot build.</b> <c>is_active</c> is written
    /// <c>true</c> at creation and by nothing else in the product -- there is no deactivation
    /// route yet, though the column is indexed for one and the benchmarks table renders it --
    /// so the row is retired straight through the DbContext, which is what a support fix or
    /// that future route will do. The alternative was to leave the predicate as the only
    /// condition in the matching rule that nothing anywhere asserts.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_deactivated_benchmark_is_not_suggested_as_a_prior_period()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"retired-{Guid.NewGuid():N}";

        var retired = await CreateAsync(client, "2024 retired", _companyAId, category: category);
        var inUse = await CreateAsync(client, "2025 in use", _companyAId, category: category);
        var subject = await CreateAsync(client, "2026 subject", _companyAId, category: category);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.Benchmarks.FirstAsync(b => b.Id == retired.Id);
            row.IsActive = false;
            await db.SaveChangesAsync();
        }

        var response = await client.GetAsync($"/admin/benchmarks/{subject.Id}/prior-period/candidates");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var only = Assert.Single((await response.Content.ReadFromJsonAsync<List<PriorPeriodCandidateDto>>())!);
        Assert.Equal(inUse.Id, only.Id);
        Assert.True(only.Unambiguous);

        // And so the backfill has exactly one answer for this benchmark rather than a
        // judgement call it is not allowed to make.
        var dryRun = await client.PostAsync("/admin/benchmarks/prior-period/backfill", null);
        var planned = (await dryRun.Content.ReadFromJsonAsync<PriorPeriodBackfillResult>())!;
        var decision = planned.Decisions.Single(d => d.BenchmarkId == subject.Id);
        Assert.Equal("linked", decision.Outcome);
        Assert.Equal(inUse.Id, decision.PriorPeriodBenchmarkId);
    }

    /// <summary>
    /// The backfill is a dry run unless told otherwise, links only where there is nothing to
    /// choose between, and never overwrites an answer somebody already gave.
    ///
    /// <para>
    /// This is what replaces #89's "populate during #154". #154 and its whole ETL were
    /// deleted (<c>docs/decisions/no-data-migration.md</c>), so there is no import to
    /// populate anything during; the rows needing a link are the ones this product made
    /// itself.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_backfill_reports_before_it_writes_and_only_links_the_unambiguous()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        // Unambiguous: exactly one earlier benchmark in this category.
        var soloPrior = await CreateAsync(client, "solo 2025", _companyAId, category: "solo");
        var solo = await CreateAsync(client, "solo 2026", _companyAId, category: "solo");

        // Ambiguous: two earlier benchmarks, so no automatic answer is defensible.
        await CreateAsync(client, "pair 2024", _companyAId, category: "pair");
        await CreateAsync(client, "pair 2025", _companyAId, category: "pair");
        var pair = await CreateAsync(client, "pair 2026", _companyAId, category: "pair");

        // Declared to have none: an administrator's answer, not an absence.
        var declared = await CreateAsync(client, "declared 2026", _companyAId, category: "declared");
        Assert.Equal(HttpStatusCode.OK, (await SetPriorPeriodAsync(client, declared.Id, PriorPeriodStatuses.None)).StatusCode);

        var dryRun = await client.PostAsync("/admin/benchmarks/prior-period/backfill", null);
        Assert.Equal(HttpStatusCode.OK, dryRun.StatusCode);
        var planned = (await dryRun.Content.ReadFromJsonAsync<PriorPeriodBackfillResult>())!;
        Assert.False(planned.Applied);
        // Five unlinked rows in this company; `declared` is not among them because it already
        // carries an answer. Two are unambiguous (`solo` behind `soloPrior`, `pair 2025`
        // behind `pair 2024`), two have nothing earlier at all, and `pair 2026` has a choice
        // to make and so is left to a human.
        Assert.Equal(5, planned.Considered);
        Assert.Equal(2, planned.Linked);
        Assert.Equal(1, planned.Ambiguous);
        Assert.Equal(2, planned.NoCandidate);
        Assert.Equal(soloPrior.Id, planned.Decisions.Single(d => d.BenchmarkId == solo.Id).PriorPeriodBenchmarkId);
        Assert.Equal("ambiguous", planned.Decisions.Single(d => d.BenchmarkId == pair.Id).Outcome);
        Assert.Equal("no-candidate", planned.Decisions.Single(d => d.BenchmarkId == soloPrior.Id).Outcome);
        Assert.DoesNotContain(planned.Decisions, d => d.BenchmarkId == declared.Id);

        // Reporting wrote nothing.
        Assert.Equal(PriorPeriodStatuses.Unlinked, (await GetAsync(client, solo.Id)).PriorPeriodStatus);

        var applied = await client.PostAsync("/admin/benchmarks/prior-period/backfill?apply=true", null);
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        Assert.True((await applied.Content.ReadFromJsonAsync<PriorPeriodBackfillResult>())!.Applied);

        var linkedSolo = await GetAsync(client, solo.Id);
        Assert.Equal(PriorPeriodStatuses.Linked, linkedSolo.PriorPeriodStatus);
        Assert.Equal(soloPrior.Id, linkedSolo.PriorPeriodBenchmarkId);

        Assert.Equal(PriorPeriodStatuses.Unlinked, (await GetAsync(client, pair.Id)).PriorPeriodStatus);
        Assert.Equal(PriorPeriodStatuses.None, (await GetAsync(client, declared.Id)).PriorPeriodStatus);
    }

    /// <summary>
    /// A CompanyAdmin's backfill cannot reach the global benchmarks they can read.
    ///
    /// <para>
    /// Global rows are visible to every tenant and SuperAdmin-only to write -- the rule #84
    /// closed on create, and a bulk path is exactly the shape that reopens it. Asserted on
    /// the global row's stored status after a CompanyAdmin's applied run, not on the
    /// response's counts, because a count is a claim about what the endpoint thinks it did.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_company_admins_backfill_leaves_global_benchmarks_alone()
    {
        var category = $"global-{Guid.NewGuid():N}";
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        await CreateAsync(superAdmin, $"global prior {category}", null, category: category);
        var globalSubject = await CreateAsync(superAdmin, $"global subject {category}", null, category: category);

        var companyAdmin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var applied = await companyAdmin.PostAsync("/admin/benchmarks/prior-period/backfill?apply=true", null);
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var stored = await db.Benchmarks.AsNoTracking().FirstAsync(b => b.Id == globalSubject.Id);
        Assert.Equal(PriorPeriodStatuses.Unlinked, stored.PriorPeriodStatus);
        Assert.Null(stored.PriorPeriodBenchmarkId);
    }

    /// <summary>
    /// A CompanyAdmin may not set a prior period on a global benchmark, only read one.
    /// </summary>
    [Fact]
    public async Task A_company_admin_cannot_link_a_global_benchmark()
    {
        var category = $"globalwrite-{Guid.NewGuid():N}";
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var globalPrior = await CreateAsync(superAdmin, $"global prior {category}", null, category: category);
        var globalSubject = await CreateAsync(superAdmin, $"global subject {category}", null, category: category);

        var companyAdmin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var write = await SetPriorPeriodAsync(companyAdmin, globalSubject.Id, PriorPeriodStatuses.Linked, globalPrior.Id);
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);

        var read = await companyAdmin.GetAsync($"/admin/benchmarks/{globalSubject.Id}/prior-period/candidates");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    /// <summary>
    /// A benchmark whose prior period belongs to a tenant the caller cannot read comes back
    /// without the comparison rather than with somebody else's numbers in it.
    ///
    /// <para>
    /// Not reachable through the write path any more -- <see
    /// cref="A_prior_period_must_share_the_benchmarks_scope_category_and_type"/> refuses it --
    /// which is precisely why the read side is asserted separately: rows written before #89
    /// carry no such promise, and the detail projection must not take the link's existence as
    /// permission.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_prior_period_the_caller_may_not_read_is_omitted_from_the_detail()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var companyBPrior = await CreateAsync(superAdmin, "B 2025 leak", _companyBId);
        var companyASubject = await CreateAsync(superAdmin, "A 2026 leak", _companyAId);

        // The pre-#89 shape, written the only way it can now exist: straight to the row.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.Benchmarks.FirstAsync(b => b.Id == companyASubject.Id);
            row.PriorPeriodBenchmarkId = companyBPrior.Id;
            row.PriorPeriodStatus = PriorPeriodStatuses.Linked;
            await db.SaveChangesAsync();
        }

        var companyAdmin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var detail = await GetAsync(companyAdmin, companyASubject.Id);

        Assert.Equal(PriorPeriodStatuses.Linked, detail.PriorPeriodStatus);
        Assert.Null(detail.PriorPeriod);
        // The pointer goes too, and this half is the one that was missing: withholding the
        // comparison while returning the id still tells company A that a benchmark with this
        // id exists in a tenant they cannot see, hands them an id they could not have guessed,
        // and sends the benchmarks page off to fetch it (`followPriorPeriodChain`) for a 403.
        // `linked` with nothing attached is still distinguishable from `unlinked` -- that is
        // what the status is for.
        Assert.Null(detail.PriorPeriodBenchmarkId);

        // The SuperAdmin, who may read both, still sees both. Withholding is a property of
        // this reader, not of the row: blanking the pointer for everybody would break the
        // trend chain for the caller entitled to walk it.
        var superAdminDetail = await GetAsync(superAdmin, companyASubject.Id);
        Assert.NotNull(superAdminDetail.PriorPeriod);
        Assert.Equal(companyBPrior.Id, superAdminDetail.PriorPeriodBenchmarkId);
    }

    /// <summary>
    /// Two ways of naming a benchmark this caller may not link to, refused in the same words.
    ///
    /// <para>
    /// A GUID that is not a benchmark at all and a GUID that is another tenant's benchmark
    /// used to produce two different messages, which made the route an existence oracle: put
    /// an id in the body, read the wording, learn whether it names a row. The whole response
    /// body is compared rather than the message field, because anything that differs at all is
    /// the signal.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_unknown_id_and_another_tenants_id_are_refused_in_the_same_words()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var otherTenant = await CreateAsync(superAdmin, "B 2025 oracle", _companyBId);

        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(client, "2026 oracle", _companyAId);

        var unknown = await SetPriorPeriodAsync(client, subject.Id, PriorPeriodStatuses.Linked, Guid.NewGuid());
        var foreign = await SetPriorPeriodAsync(client, subject.Id, PriorPeriodStatuses.Linked, otherTenant.Id);

        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        Assert.Equal(await unknown.Content.ReadAsStringAsync(), await foreign.Content.ReadAsStringAsync());

        // Create is the other door onto the same rule, and it must not answer differently
        // either.
        async Task<string> CreateWithPriorAsync(Guid priorId)
        {
            var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
                "2026 oracle create", "d", "industry", "engagement", "internal", null, null, null, _companyAId, priorId));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            return await response.Content.ReadAsStringAsync();
        }

        Assert.Equal(await CreateWithPriorAsync(Guid.NewGuid()), await CreateWithPriorAsync(otherTenant.Id));
    }

    /// <summary>
    /// Neither the suggestion route nor the bulk one is open to anybody below an
    /// administrator.
    ///
    /// <para>
    /// Nothing asserted this: the benchmarks tests exercise SuperAdmin and CompanyAdmin only,
    /// so both new routes could have had their authorization removed outright without a single
    /// test noticing. The backfill is the one that matters -- it is a bulk WRITER whose only
    /// gate is the role check -- so its refusal is asserted against the stored rows and not
    /// against the status code, which is a claim about what the endpoint thinks it did.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task Suggesting_and_backfilling_are_closed_below_an_administrator(string role)
    {
        var admin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"below-admin-{Guid.NewGuid():N}";
        var prior = await CreateAsync(admin, "2025 below", _companyAId, category: category);
        var subject = await CreateAsync(admin, "2026 below", _companyAId, category: category);

        var client = await ClientAsync(role, _companyADomain, _companyAId);

        var candidates = await client.GetAsync($"/admin/benchmarks/{subject.Id}/prior-period/candidates");
        Assert.Equal(HttpStatusCode.Forbidden, candidates.StatusCode);

        var backfill = await client.PostAsync("/admin/benchmarks/prior-period/backfill?apply=true", null);
        Assert.Equal(HttpStatusCode.Forbidden, backfill.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var stored = await db.Benchmarks.AsNoTracking().FirstAsync(b => b.Id == subject.Id);
        Assert.Equal(PriorPeriodStatuses.Unlinked, stored.PriorPeriodStatus);
        Assert.Null(stored.PriorPeriodBenchmarkId);
        Assert.NotEqual(prior.Id, stored.PriorPeriodBenchmarkId);
    }

    /// <summary>
    /// The database refuses a status that is not one of the three, whatever writes it.
    ///
    /// <para>
    /// The other half of <c>ck_benchmarks_prior_period_status</c>, and it is load-bearing on
    /// its own: for a row with no pointer the second clause reads <c>false = false</c>, which
    /// is true, so the vocabulary list is the only thing standing between a bulk writer (#90)
    /// and a stored status nothing recognises. A benchmark carrying one renders no sentence at
    /// all on the prior-period panel -- every branch there tests for a known value -- which is
    /// precisely the silence the third state was added to end.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_database_refuses_a_status_that_is_not_one_of_the_three()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(client, "vocabulary subject", _companyAId);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.Benchmarks.FirstAsync(b => b.Id == subject.Id);
            // No pointer, so the pointer/status clause is satisfied and only the vocabulary
            // can refuse this.
            row.PriorPeriodStatus = "archived";
            await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }

        // Read back through the route, in a fresh scope: the value the page would have had to
        // make sense of never landed.
        Assert.Equal(PriorPeriodStatuses.Unlinked, (await GetAsync(client, subject.Id)).PriorPeriodStatus);
    }

    /// <summary>
    /// A prior period that read zero yields the change and withholds the ratio.
    ///
    /// <para>
    /// Zero is an ordinary reading for half the things a climate benchmark counts --
    /// grievances, accidents, resignations -- and "5 more than last year" is exactly what a
    /// reader wants from it. The ratio is the part that cannot exist: 5/0 is infinity, and an
    /// infinity does not survive System.Text.Json, so the guard is what stands between a
    /// zero-valued prior period and a detail response that will not serialise at all.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_prior_period_that_read_zero_gives_a_change_but_no_ratio()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"zero-{Guid.NewGuid():N}";

        var prior = await CreateAsync(client, "2025 zero", _companyAId, category: category);
        await AddMetricAsync(client, prior.Id, "formal_grievances", 0, "count");
        var current = await CreateAsync(client, "2026 zero", _companyAId, category: category);
        await AddMetricAsync(client, current.Id, "formal_grievances", 5, "count");

        Assert.Equal(HttpStatusCode.OK,
            (await SetPriorPeriodAsync(client, current.Id, PriorPeriodStatuses.Linked, prior.Id)).StatusCode);

        var change = Assert.Single((await GetAsync(client, current.Id)).PriorPeriod!.Metrics);
        Assert.Equal(0d, change.PriorValue!.Value);
        Assert.Equal(5d, change.Delta!.Value);
        Assert.Null(change.ChangeRatio);
    }

    /// <summary>
    /// Last year's figures, typed in this year, are still last year's figures.
    ///
    /// <para>
    /// This test exists to hold a decision open rather than to close a hole. The matching rule
    /// requires a candidate to be <c>CreatedAt</c>-earlier and the write path deliberately does
    /// not, because <c>created_at</c> records when somebody typed the row in and a benchmark
    /// has no period field at all. Entering 2025's numbers after 2026's are already in is
    /// ordinary -- it is the very example
    /// <c>docs/decisions/prior-period-benchmark-linkage.md</c> uses to argue against automatic
    /// matching -- and it makes the earlier period the younger ROW. An ordering check on the
    /// write path reads as a tightening and would refuse the one case explicit linkage exists
    /// to serve, so it is asserted here that it does not.
    /// </para>
    /// <para>
    /// The suggestion side is asserted in the same test, because the two answers being
    /// different is the point: the shortlist says nothing, and the administrator says 2025.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_earlier_period_typed_in_late_can_still_be_linked()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"late-entry-{Guid.NewGuid():N}";

        var current = await CreateAsync(client, "2026 Engagement", _companyAId, category: category);
        await AddMetricAsync(client, current.Id, "engagement_score", 74, "percent");
        // Typed in afterwards, and older in every sense except the one the database records.
        var lastYear = await CreateAsync(client, "2025 Engagement", _companyAId, category: category);
        await AddMetricAsync(client, lastYear.Id, "engagement_score", 70, "percent");

        Assert.Equal(HttpStatusCode.OK,
            (await SetPriorPeriodAsync(client, current.Id, PriorPeriodStatuses.Linked, lastYear.Id)).StatusCode);

        var detail = await GetAsync(client, current.Id);
        Assert.Equal(lastYear.Id, detail.PriorPeriodBenchmarkId);
        Assert.Equal(4d, Assert.Single(detail.PriorPeriod!.Metrics).Delta!.Value);

        // The shortlist would never have proposed it, and that asymmetry is deliberate: a
        // suggestion may lean on `created_at`, an answer may not be refused by it.
        var candidates = await client.GetAsync($"/admin/benchmarks/{current.Id}/prior-period/candidates");
        Assert.Empty((await candidates.Content.ReadFromJsonAsync<List<PriorPeriodCandidateDto>>())!);
    }
}
