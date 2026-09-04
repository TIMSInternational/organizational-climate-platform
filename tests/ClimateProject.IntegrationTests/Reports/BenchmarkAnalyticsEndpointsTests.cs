using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
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
/// The analytical benchmark routes (#90): compare, trends, industry, categories, import and
/// validate.
///
/// <para>
/// Every fixture is built through the routes an administrator actually uses -- POST
/// /admin/benchmarks, POST .../metrics, PUT .../prior-period, POST .../import -- for the
/// reason the #89 suite gives: a hand-inserted row asserts arithmetic over a payload no
/// producer writes, and passes whether or not the feature exists. The two exceptions are named
/// where they occur, and both are tests whose subject IS a row no current route can write.
/// </para>
/// <para>
/// Where a test aggregates, it tags its fixture with a per-test <c>industry</c> or
/// <c>category</c> token. The Postgres container is shared across the whole suite, so an
/// aggregate over "every benchmark this caller can read" would otherwise be an aggregate over
/// whatever else was running at the time.
/// </para>
/// </summary>
[Collection("Postgres")]
public class BenchmarkAnalyticsEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"analytics-a-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"analytics-b-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public BenchmarkAnalyticsEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Analytics Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Analytics Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
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
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue) user.CompanyId = companyId.Value;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<BenchmarkDetail> CreateAsync(
        HttpClient client,
        string name,
        Guid? companyId,
        string category = "engagement",
        string type = "industry",
        string? industry = null,
        string? companySize = null,
        string? region = null)
    {
        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            name, "d", type, category, "internal", industry, companySize, region, companyId, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BenchmarkDetail>())!;
    }

    private static async Task AddMetricAsync(
        HttpClient client, Guid benchmarkId, string metricName, double value, string unit,
        double? percentile = null, int? sampleSize = null)
    {
        var response = await client.PostAsJsonAsync(
            $"/admin/benchmarks/{benchmarkId}/metrics",
            new AddBenchmarkMetricRequest(metricName, value, unit, percentile, sampleSize));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task LinkAsync(HttpClient client, Guid id, Guid priorId)
    {
        var response = await client.PutAsJsonAsync(
            $"/admin/benchmarks/{id}/prior-period", new SetPriorPeriodRequest(PriorPeriodStatuses.Linked, priorId));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task DeclareNoPriorPeriodAsync(HttpClient client, Guid id)
    {
        var response = await client.PutAsJsonAsync(
            $"/admin/benchmarks/{id}/prior-period", new SetPriorPeriodRequest(PriorPeriodStatuses.None, null));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ===================================================================================
    // compare
    // ===================================================================================

    /// <summary>
    /// The headline criterion of #90: "comparison returns correct deltas against a known
    /// fixture".
    ///
    /// <para>
    /// Three benchmarks, each given its readings through the metrics route, compared against a
    /// baseline the caller names. The assertions are on the arithmetic -- 82 against 70 is +12,
    /// 64 against 70 is -6, and the ratios are those over 70 -- because "a comparison came
    /// back" and "the comparison is right" are different claims and only the second is the
    /// feature. The baseline itself is asserted too: it is the row named in
    /// <c>baselineId</c>, NOT the first id, and getting that backwards silently flips the sign
    /// of every number on the page.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Compare_reports_each_benchmark_against_the_named_baseline()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"compare-{Guid.NewGuid():N}";

        var sector = await CreateAsync(client, "Sector 2026", _companyAId, category: category);
        await AddMetricAsync(client, sector.Id, "engagement_score", 70, "percent");

        var strong = await CreateAsync(client, "Strong unit", _companyAId, category: category);
        await AddMetricAsync(client, strong.Id, "engagement_score", 82, "percent");

        var weak = await CreateAsync(client, "Weak unit", _companyAId, category: category);
        await AddMetricAsync(client, weak.Id, "engagement_score", 64, "percent");

        var response = await client.GetAsync(
            $"/admin/benchmarks/compare?ids={strong.Id},{weak.Id},{sector.Id}&baselineId={sector.Id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<BenchmarkComparisonResult>())!;

        Assert.Equal(sector.Id, result.Baseline.Id);
        Assert.Equal(70d, Assert.Single(result.BaselineMetrics).Value);
        Assert.Equal(2, result.Comparisons.Count);

        var strongRow = result.Comparisons.Single(c => c.Benchmark.Id == strong.Id);
        var strongMetric = Assert.Single(strongRow.Metrics);
        Assert.Equal("engagement_score", strongMetric.MetricName);
        Assert.Equal(82d, strongMetric.Value);
        Assert.Equal(70d, strongMetric.BaselineValue);
        Assert.Equal(12d, strongMetric.Delta!.Value, 10);
        Assert.Equal(12d / 70d, strongMetric.ChangeRatio!.Value, 10);

        var weakRow = result.Comparisons.Single(c => c.Benchmark.Id == weak.Id);
        var weakMetric = Assert.Single(weakRow.Metrics);
        Assert.Equal(-6d, weakMetric.Delta!.Value, 10);
        Assert.Equal(-6d / 70d, weakMetric.ChangeRatio!.Value, 10);
    }

    /// <summary>
    /// A comparison withholds the difference when the two sides are not in the same unit.
    ///
    /// <para>
    /// #89 established the rule for the year-over-year reading and asserted it there. This
    /// asserts it holds on the NEW route, which is the only thing that proves compare goes
    /// through the same function rather than having grown its own subtraction: 0.68 as a
    /// fraction against 70 as a percent differences to -69.32, a collapse that did not happen,
    /// and it is a number a comparison table would print without hesitation.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Compare_withholds_a_delta_across_two_different_units()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"compare-units-{Guid.NewGuid():N}";

        var baseline = await CreateAsync(client, "Baseline percent", _companyAId, category: category);
        await AddMetricAsync(client, baseline.Id, "engagement_score", 70, "percent");

        var other = await CreateAsync(client, "Other fraction", _companyAId, category: category);
        await AddMetricAsync(client, other.Id, "engagement_score", 0.68, "fraction");

        var response = await client.GetAsync($"/admin/benchmarks/compare?ids={other.Id},{baseline.Id}&baselineId={baseline.Id}");
        var result = (await response.Content.ReadFromJsonAsync<BenchmarkComparisonResult>())!;

        var metric = Assert.Single(Assert.Single(result.Comparisons).Metrics);
        Assert.Equal(0.68d, metric.Value);
        Assert.Equal("fraction", metric.Unit);
        Assert.Equal(70d, metric.BaselineValue);
        Assert.Equal("percent", metric.BaselineUnit);
        Assert.Null(metric.Delta);
        Assert.Null(metric.ChangeRatio);
    }

    /// <summary>
    /// Naming several benchmarks in one request is not a way to read one the caller could not
    /// read alone.
    ///
    /// <para>
    /// The obvious failure for a multi-id route: authorize the caller once, then load
    /// everything they asked for. Company B's benchmark is in the list beside one company A
    /// may read, and the whole request is refused.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Compare_refuses_a_list_containing_another_tenants_benchmark()
    {
        var adminB = await ClientAsync(Roles.CompanyAdmin, _companyBDomain, _companyBId);
        var theirs = await CreateAsync(adminB, "Company B benchmark", _companyBId);

        var adminA = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var mine = await CreateAsync(adminA, "Company A benchmark", _companyAId);

        var response = await adminA.GetAsync($"/admin/benchmarks/compare?ids={mine.Id},{theirs.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>One id is not a comparison, and a malformed id is not an empty result.</summary>
    [Fact]
    public async Task Compare_refuses_a_single_id_and_a_malformed_one()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var only = await CreateAsync(client, "Lonely", _companyAId);

        // The same id twice is deduplicated, so it is also "a single id".
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.GetAsync($"/admin/benchmarks/compare?ids={only.Id},{only.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.GetAsync($"/admin/benchmarks/compare?ids={only.Id},not-a-guid")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.GetAsync($"/admin/benchmarks/compare?ids={only.Id},{Guid.NewGuid()}&baselineId={Guid.NewGuid()}")).StatusCode);
    }

    // ===================================================================================
    // trends
    // ===================================================================================

    /// <summary>
    /// The year-over-year half of the client's acceptance bar, over a chain longer than one
    /// step and assembled by the server rather than by the browser.
    ///
    /// <para>
    /// Three periods, 60 then 70 then 76, linked through the prior-period route. The
    /// assertions are the readings and the differences between adjacent periods -- +10 on
    /// 60 and +6 on 70 -- with the oldest period carrying no delta because there is nothing
    /// before it. A metric that only the newest period records is included on purpose: the
    /// series must still be the same length as the period list, or a chart indexing the two
    /// together plots last year's number under this year's label.
    /// </para>
    /// <para>
    /// <c>StopReason</c> is asserted as <c>none</c>, which is the oldest period's declared
    /// answer and not merely the end of the data. A trend that stopped because the caller
    /// cannot see further looks identical without it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Trends_walks_the_whole_chain_and_differences_adjacent_periods()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"trend-{Guid.NewGuid():N}";

        var y2024 = await CreateAsync(client, "2024 Engagement", _companyAId, category: category);
        await AddMetricAsync(client, y2024.Id, "engagement_score", 60, "percent");
        var y2025 = await CreateAsync(client, "2025 Engagement", _companyAId, category: category);
        await AddMetricAsync(client, y2025.Id, "engagement_score", 70, "percent");
        var y2026 = await CreateAsync(client, "2026 Engagement", _companyAId, category: category);
        await AddMetricAsync(client, y2026.Id, "engagement_score", 76, "percent");
        // Recorded for the first time this year.
        await AddMetricAsync(client, y2026.Id, "absence_rate", 3.2, "percent");

        await DeclareNoPriorPeriodAsync(client, y2024.Id);
        await LinkAsync(client, y2025.Id, y2024.Id);
        await LinkAsync(client, y2026.Id, y2025.Id);

        var response = await client.GetAsync($"/admin/benchmarks/{y2026.Id}/trends");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var trend = (await response.Content.ReadFromJsonAsync<BenchmarkTrendResult>())!;

        Assert.Equal(new[] { y2024.Id, y2025.Id, y2026.Id }, trend.Periods.Select(p => p.Id).ToArray());
        Assert.Equal(BenchmarkTrendStopReasons.None, trend.StopReason);

        var engagement = trend.Series.Single(s => s.MetricName == "engagement_score");
        Assert.Equal(3, engagement.Points.Count);
        Assert.Equal(new double?[] { 60, 70, 76 }, engagement.Points.Select(p => p.Value).ToArray());
        Assert.Null(engagement.Points[0].Delta);
        Assert.Equal(10d, engagement.Points[1].Delta!.Value, 10);
        Assert.Equal(10d / 60d, engagement.Points[1].ChangeRatio!.Value, 10);
        Assert.Equal(6d, engagement.Points[2].Delta!.Value, 10);
        Assert.Equal(6d / 70d, engagement.Points[2].ChangeRatio!.Value, 10);

        var absence = trend.Series.Single(s => s.MetricName == "absence_rate");
        Assert.Equal(3, absence.Points.Count);
        Assert.Equal(new double?[] { null, null, 3.2 }, absence.Points.Select(p => p.Value).ToArray());
        Assert.All(absence.Points, p => Assert.Null(p.Delta));
    }

    /// <summary>
    /// A chain that has not been linked yet says so, rather than reporting a one-period trend
    /// that looks complete.
    /// </summary>
    [Fact]
    public async Task Trends_of_an_unlinked_benchmark_is_one_period_and_says_why()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(client, "Never linked", _companyAId, category: $"trend-solo-{Guid.NewGuid():N}");
        await AddMetricAsync(client, subject.Id, "engagement_score", 71, "percent");

        var trend = (await (await client.GetAsync($"/admin/benchmarks/{subject.Id}/trends"))
            .Content.ReadFromJsonAsync<BenchmarkTrendResult>())!;

        Assert.Equal(subject.Id, Assert.Single(trend.Periods).Id);
        Assert.Equal(BenchmarkTrendStopReasons.Unlinked, trend.StopReason);
        Assert.Null(Assert.Single(Assert.Single(trend.Series).Points).Delta);
    }

    /// <summary>
    /// A hop the caller may not read ends the walk, and the walk does not say what is on the
    /// other side of it.
    ///
    /// <para>
    /// <b>The link here is written directly, and that is the subject of the test.</b> No route
    /// can create it: <c>ValidateLinkTarget</c> has required both ends of a link to be in the
    /// same company scope since #89. What can exist is a row linked BEFORE that check did, and
    /// this reproduces one -- a global benchmark pointing into a tenant. The route must stop,
    /// must not leak the id it stopped at, and must say <c>withheld</c> so a page does not
    /// present a truncated trend as the whole history.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Trends_stops_at_a_hop_the_caller_may_not_read_and_withholds_it()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"trend-withheld-{Guid.NewGuid():N}";

        var adminB = await ClientAsync(Roles.CompanyAdmin, _companyBDomain, _companyBId);
        var hidden = await CreateAsync(adminB, "Company B period", _companyBId, category: category);
        await AddMetricAsync(adminB, hidden.Id, "engagement_score", 55, "percent");

        var global = await CreateAsync(superAdmin, "Global period", null, category: category);
        await AddMetricAsync(superAdmin, global.Id, "engagement_score", 72, "percent");

        // The cross-scope link no handler will write, written the only way it can be.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.Benchmarks.FirstAsync(b => b.Id == global.Id);
            row.PriorPeriodBenchmarkId = hidden.Id;
            row.PriorPeriodStatus = PriorPeriodStatuses.Linked;
            await db.SaveChangesAsync();
        }

        var adminA = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var trend = (await (await adminA.GetAsync($"/admin/benchmarks/{global.Id}/trends"))
            .Content.ReadFromJsonAsync<BenchmarkTrendResult>())!;

        Assert.Equal(global.Id, Assert.Single(trend.Periods).Id);
        Assert.Equal(BenchmarkTrendStopReasons.Withheld, trend.StopReason);
        Assert.DoesNotContain(hidden.Id, trend.Periods.Select(p => p.Id));

        // A SuperAdmin, who may read both ends, gets the whole chain from the same route --
        // so the stop above is the authorization check and not a broken walk.
        var full = (await (await superAdmin.GetAsync($"/admin/benchmarks/{global.Id}/trends"))
            .Content.ReadFromJsonAsync<BenchmarkTrendResult>())!;
        Assert.Equal(new[] { hidden.Id, global.Id }, full.Periods.Select(p => p.Id).ToArray());
        Assert.Equal(17d, full.Series.Single(s => s.MetricName == "engagement_score").Points[1].Delta!.Value, 10);
    }

    /// <summary>
    /// A chain that loops terminates and is reported as a loop, rather than hanging.
    ///
    /// <para>
    /// The second test whose subject is a row no route can write: cycles have been refused on
    /// write since #89, but the only check before that was "does the target exist", so A→B→A
    /// is creatable in any database older than that change. A read path that spins on data the
    /// write path used to allow is a production outage, not a data-quality problem.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Trends_terminates_on_a_chain_that_loops()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"trend-cycle-{Guid.NewGuid():N}";
        var a = await CreateAsync(client, "Loop A", _companyAId, category: category);
        var b = await CreateAsync(client, "Loop B", _companyAId, category: category);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var rowA = await db.Benchmarks.FirstAsync(x => x.Id == a.Id);
            var rowB = await db.Benchmarks.FirstAsync(x => x.Id == b.Id);
            rowA.PriorPeriodBenchmarkId = b.Id;
            rowA.PriorPeriodStatus = PriorPeriodStatuses.Linked;
            rowB.PriorPeriodBenchmarkId = a.Id;
            rowB.PriorPeriodStatus = PriorPeriodStatuses.Linked;
            await db.SaveChangesAsync();
        }

        var trend = (await (await client.GetAsync($"/admin/benchmarks/{a.Id}/trends").WaitAsync(TimeSpan.FromSeconds(30)))
            .Content.ReadFromJsonAsync<BenchmarkTrendResult>())!;

        Assert.Equal(new[] { b.Id, a.Id }, trend.Periods.Select(p => p.Id).ToArray());
        Assert.Equal(BenchmarkTrendStopReasons.Cycle, trend.StopReason);
    }

    // ===================================================================================
    // industry
    // ===================================================================================

    /// <summary>
    /// The sector half of the client's acceptance bar: where does this benchmark sit against
    /// the others in its industry.
    ///
    /// <para>
    /// Peers reading 60, 70 and 80 and a subject reading 75. The mean is 70 and NOT 71.25,
    /// which is the assertion that matters: the subject is excluded from the sector it is being
    /// measured against, and a subject counted into its own mean pulls that mean toward itself
    /// and shrinks the very gap the reading exists to show. Everything else follows from that
    /// -- +5 against the mean, and two of three peers below it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_places_a_benchmark_in_its_sector_without_counting_it_in_the_sector()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var industry = $"manufacturing-{Guid.NewGuid():N}";
        var category = $"industry-{Guid.NewGuid():N}";

        foreach (var value in new[] { 60d, 70d, 80d })
        {
            var peer = await CreateAsync(client, $"Peer {value}", null, category: category, industry: industry);
            await AddMetricAsync(client, peer.Id, "engagement_score", value, "percent", sampleSize: 100);
        }

        var subject = await CreateAsync(client, "Us", _companyAId, category: category, industry: industry);
        await AddMetricAsync(client, subject.Id, "engagement_score", 75, "percent", sampleSize: 40);

        var response = await client.GetAsync($"/admin/benchmarks/industry?benchmarkId={subject.Id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        // Industry and category were defaulted from the subject -- this is the legacy `similar`
        // route's question, asked through this one.
        Assert.Equal(industry, result.Filters.Industry);
        Assert.Equal(category, result.Filters.Category);
        Assert.Equal(subject.Id, result.Subject!.Id);
        Assert.Equal(3, result.BenchmarkCount);

        var metric = Assert.Single(result.Metrics);
        Assert.Equal("engagement_score", metric.MetricName);
        Assert.Equal("percent", metric.Unit);
        Assert.Equal(3, metric.BenchmarkCount);
        Assert.Equal(70d, metric.Mean, 10);
        Assert.Equal(70d, metric.Median, 10);
        Assert.Equal(60d, metric.Min, 10);
        Assert.Equal(80d, metric.Max, 10);
        Assert.Equal(300, metric.TotalSampleSize);
        Assert.Equal(75d, metric.SubjectValue!.Value, 10);
        Assert.Equal(5d, metric.SubjectDelta!.Value, 10);
        Assert.Equal(5d / 70d, metric.SubjectChangeRatio!.Value, 10);
        Assert.Equal(200d / 3d, metric.SubjectPercentileRank!.Value, 10);
    }

    /// <summary>
    /// A sector never averages across two units.
    ///
    /// <para>
    /// The same rule as the withheld delta, one level up and with a different answer: a
    /// comparison can decline to subtract, but a mean has to be a mean OF something, so the two
    /// units are simply two rows. Mixing them would produce a single "average engagement" of
    /// 35.34 across 70 percent and 0.68 as a fraction -- a number true of neither benchmark and
    /// impossible to spot downstream.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_never_averages_two_units_into_one_number()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var industry = $"units-{Guid.NewGuid():N}";
        var category = $"units-{Guid.NewGuid():N}";

        var asPercent = await CreateAsync(client, "Percent house", null, category: category, industry: industry);
        await AddMetricAsync(client, asPercent.Id, "engagement_score", 70, "percent");
        var asFraction = await CreateAsync(client, "Fraction house", null, category: category, industry: industry);
        await AddMetricAsync(client, asFraction.Id, "engagement_score", 0.68, "fraction");

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?industry={industry}&category={category}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        Assert.Equal(2, result.Metrics.Count);
        var percent = result.Metrics.Single(m => m.Unit == "percent");
        var fraction = result.Metrics.Single(m => m.Unit == "fraction");
        Assert.Equal(70d, percent.Mean, 10);
        Assert.Equal(1, percent.BenchmarkCount);
        Assert.Equal(0.68d, fraction.Mean, 10);
        Assert.Equal(1, fraction.BenchmarkCount);
    }

    /// <summary>
    /// A CompanyAdmin's sector is made of what they may read, and another tenant's numbers are
    /// not in it.
    /// </summary>
    [Fact]
    public async Task Industry_does_not_aggregate_another_tenants_benchmarks()
    {
        var industry = $"scoped-{Guid.NewGuid():N}";
        var category = $"scoped-{Guid.NewGuid():N}";

        var adminB = await ClientAsync(Roles.CompanyAdmin, _companyBDomain, _companyBId);
        var theirs = await CreateAsync(adminB, "Company B row", _companyBId, category: category, industry: industry);
        await AddMetricAsync(adminB, theirs.Id, "engagement_score", 20, "percent");

        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var global = await CreateAsync(superAdmin, "Global row", null, category: category, industry: industry);
        await AddMetricAsync(superAdmin, global.Id, "engagement_score", 80, "percent");

        var adminA = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var result = (await (await adminA.GetAsync($"/admin/benchmarks/industry?industry={industry}&category={category}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        // Only the global row. If company B's 20 had leaked in, the mean would be 50.
        Assert.Equal(1, result.BenchmarkCount);
        Assert.Equal(80d, Assert.Single(result.Metrics).Mean, 10);

        // And the SuperAdmin, who may read both, gets both -- so the exclusion above is the
        // tenant rule and not an empty fixture.
        var acrossTenants = (await (await superAdmin.GetAsync($"/admin/benchmarks/industry?industry={industry}&category={category}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;
        Assert.Equal(2, acrossTenants.BenchmarkCount);
        Assert.Equal(50d, Assert.Single(acrossTenants.Metrics).Mean, 10);
    }

    // ===================================================================================
    // categories
    // ===================================================================================

    /// <summary>
    /// The category list is the caller's readable scope, and nothing else.
    ///
    /// <para>
    /// Three categories exist -- one global, one company A's, one company B's -- and company
    /// A's admin sees exactly two of them. The counts are asserted rather than only the
    /// presence, because <c>globalCount</c> is what tells a CompanyAdmin how much of a
    /// category is theirs to edit.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Categories_lists_global_and_own_company_categories_only()
    {
        var token = Guid.NewGuid().ToString("N");
        var globalCategory = $"cat-global-{token}";
        var ownCategory = $"cat-own-{token}";
        var otherCategory = $"cat-other-{token}";

        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        await CreateAsync(superAdmin, "Global one", null, category: globalCategory, type: "industry");
        await CreateAsync(superAdmin, "Global two", null, category: globalCategory, type: "internal");

        var adminB = await ClientAsync(Roles.CompanyAdmin, _companyBDomain, _companyBId);
        await CreateAsync(adminB, "Company B row", _companyBId, category: otherCategory);

        var adminA = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        await CreateAsync(adminA, "Company A row", _companyAId, category: ownCategory);

        var summaries = (await (await adminA.GetAsync("/admin/benchmarks/categories"))
            .Content.ReadFromJsonAsync<List<BenchmarkCategorySummary>>())!;

        var global = summaries.Single(s => s.Category == globalCategory);
        Assert.Equal(2, global.BenchmarkCount);
        Assert.Equal(2, global.GlobalCount);
        Assert.Equal(new[] { "industry", "internal" }, global.Types.ToArray());

        var own = summaries.Single(s => s.Category == ownCategory);
        Assert.Equal(1, own.BenchmarkCount);
        Assert.Equal(0, own.GlobalCount);

        Assert.DoesNotContain(summaries, s => s.Category == otherCategory);
    }

    // ===================================================================================
    // validate
    // ===================================================================================

    /// <summary>
    /// Validating stores a score derived from the benchmark, and returns the derivation.
    ///
    /// <para>
    /// The fixture is chosen so the expected total can be written out by hand: two metrics of a
    /// possible three (0.6667 x 0.30), both with a reportable sample (1 x 0.25), both with a
    /// percentile (1 x 0.15), one attribution field of three (0.3333 x 0.20) and no unit
    /// conflict (1 x 0.10) -- 76.7, which is <c>verified</c>. The components are asserted to
    /// sum to it, because "the payload can be recomputed by hand" is the claim that makes this
    /// rule arguable with a client rather than a magic number.
    /// </para>
    /// <para>
    /// The stored row is then read back through the ordinary detail route: the score is a
    /// column two pages already render, not just a response body.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Validate_scores_a_benchmark_and_stores_what_it_scored()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(
            client, "Scored", _companyAId, category: $"validate-{Guid.NewGuid():N}", industry: "manufacturing");
        await AddMetricAsync(client, subject.Id, "engagement_score", 74, "percent", percentile: 60, sampleSize: 500);
        await AddMetricAsync(client, subject.Id, "absence_rate", 3.2, "percent", percentile: 40, sampleSize: 500);

        var before = (await (await client.GetAsync($"/admin/benchmarks/{subject.Id}"))
            .Content.ReadFromJsonAsync<BenchmarkDetail>())!;
        Assert.Equal(BenchmarkValidationStatuses.Pending, before.ValidationStatus);
        Assert.Equal(0d, before.QualityScore);

        var response = await client.PostAsync($"/admin/benchmarks/{subject.Id}/validate", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<BenchmarkValidationResult>())!;

        Assert.Equal(76.7d, result.QualityScore, 10);
        Assert.Equal(BenchmarkValidationStatuses.Verified, result.Status);
        Assert.Equal(BenchmarkValidationStatuses.Pending, result.PreviousStatus);
        Assert.Equal(0d, result.PreviousQualityScore);

        Assert.Equal(1d, result.Components.Sum(c => c.Weight), 6);
        Assert.Equal(result.QualityScore, Math.Round(result.Components.Sum(c => c.WeightedScore) * 100d, 1), 10);

        var metrics = result.Components.Single(c => c.Name == BenchmarkQuality.ComponentMetrics);
        Assert.Equal(2, metrics.Satisfied);
        Assert.Equal(BenchmarkQuality.FullMetricCount, metrics.Total);
        var attribution = result.Components.Single(c => c.Name == BenchmarkQuality.ComponentAttribution);
        Assert.Equal(1, attribution.Satisfied);
        Assert.Equal(3, attribution.Total);

        var after = (await (await client.GetAsync($"/admin/benchmarks/{subject.Id}"))
            .Content.ReadFromJsonAsync<BenchmarkDetail>())!;
        Assert.Equal(76.7d, after.QualityScore, 10);
        Assert.Equal(BenchmarkValidationStatuses.Verified, after.ValidationStatus);
    }

    /// <summary>
    /// A benchmark with nothing measured scores zero and fails, rather than collecting the
    /// components that are vacuously perfect on an empty metric list.
    ///
    /// <para>
    /// Without the short circuit, attribution and unit consistency alone carry an empty
    /// benchmark to 30 -- and with all three attribution fields filled in, to 30 plus 20, above
    /// the failure threshold. A row describing an industry and a region and measuring nothing
    /// would then be labelled <c>needs-review</c> as though the data were merely thin.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Validate_fails_a_benchmark_that_measures_nothing()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(
            client, "Described but unmeasured", _companyAId, category: $"validate-empty-{Guid.NewGuid():N}",
            industry: "manufacturing", companySize: "201-500", region: "Costa Rica");

        var result = (await (await client.PostAsync($"/admin/benchmarks/{subject.Id}/validate", null))
            .Content.ReadFromJsonAsync<BenchmarkValidationResult>())!;

        Assert.Equal(0d, result.QualityScore);
        Assert.Equal(BenchmarkValidationStatuses.Failed, result.Status);
    }

    /// <summary>
    /// A metric with no stated sample size does not count as a large one.
    ///
    /// <para>
    /// This fixture is the verified one above with two facts removed: how many people were
    /// asked, and where in a distribution the reading sits. Nothing else changes -- same two
    /// metrics, same industry, same units -- and the score falls from 76.7 to 36.7, from
    /// <c>verified</c> to <c>failed</c>. Scoring an unstated sample as though it were adequate
    /// is how a benchmark built from six responses ends up carrying a badge, so the absence has
    /// to cost the same as a bad answer would.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Validate_does_not_credit_a_metric_whose_sample_size_is_unstated()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(
            client, "Unsourced", _companyAId, category: $"validate-nosample-{Guid.NewGuid():N}", industry: "manufacturing");
        await AddMetricAsync(client, subject.Id, "engagement_score", 74, "percent");
        await AddMetricAsync(client, subject.Id, "absence_rate", 3.2, "percent");

        var result = (await (await client.PostAsync($"/admin/benchmarks/{subject.Id}/validate", null))
            .Content.ReadFromJsonAsync<BenchmarkValidationResult>())!;

        Assert.Equal(36.7d, result.QualityScore, 10);
        Assert.Equal(BenchmarkValidationStatuses.Failed, result.Status);
        Assert.Equal(0, result.Components.Single(c => c.Name == BenchmarkQuality.ComponentSampleSize).Satisfied);
        Assert.Equal(0, result.Components.Single(c => c.Name == BenchmarkQuality.ComponentDistribution).Satisfied);
    }

    /// <summary>
    /// Validating a global benchmark is a write, so a CompanyAdmin cannot do it.
    ///
    /// <para>
    /// It moves <c>quality_score</c> and <c>validation_status</c> on a row every tenant reads
    /// and every benchmarks page charts. A read check here would let any CompanyAdmin restamp
    /// the industry benchmarks the whole product compares against.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Validate_refuses_a_CompanyAdmin_on_a_global_benchmark()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var global = await CreateAsync(superAdmin, "Global to validate", null, category: $"validate-global-{Guid.NewGuid():N}");
        await AddMetricAsync(superAdmin, global.Id, "engagement_score", 70, "percent", percentile: 50, sampleSize: 900);

        var adminA = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await adminA.PostAsync($"/admin/benchmarks/{global.Id}/validate", null)).StatusCode);

        // It can still be read, and it is still unscored -- the refusal wrote nothing.
        var detail = (await (await adminA.GetAsync($"/admin/benchmarks/{global.Id}"))
            .Content.ReadFromJsonAsync<BenchmarkDetail>())!;
        Assert.Equal(BenchmarkValidationStatuses.Pending, detail.ValidationStatus);
        Assert.Equal(0d, detail.QualityScore);
    }

    // ===================================================================================
    // import / bulk
    // ===================================================================================

    private static ImportBenchmarkItem Item(string name, Guid? companyId, string category, params ImportBenchmarkMetricItem[] metrics)
        => new(name, "imported", "industry", category, "vendor file", "manufacturing", null, null, companyId, metrics);

    /// <summary>
    /// <b>#90's authorization criterion.</b> A CompanyAdmin cannot import a global benchmark,
    /// and the attempt writes nothing at all.
    ///
    /// <para>
    /// This is the hole the issue names: <c>companyId</c> is per ITEM, a null one creates a row
    /// every tenant reads, and a bulk route that authorizes the caller once and then trusts the
    /// payload reopens what #84 closed on create -- through a second door, in a request that
    /// looks like data entry. The offending item is second in the list, behind a perfectly
    /// legitimate one, because a check that runs per item and a check that runs on the first
    /// item are indistinguishable until something is hidden behind a valid row.
    /// </para>
    /// <para>
    /// The second assertion is the one that makes it a real refusal: the legitimate item did
    /// not land either. A per-item check that rejected the bad row and committed the good one
    /// would leave the caller's file and the database disagreeing, and re-running the file
    /// would then duplicate everything that did land.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Import_refuses_a_CompanyAdmins_global_benchmark_and_writes_nothing()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"import-global-{Guid.NewGuid():N}";

        var response = await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [
                Item("Legitimate own-company row", _companyAId, category, new ImportBenchmarkMetricItem("engagement_score", 70, "percent", null, 100)),
                Item("Smuggled global row", null, category, new ImportBenchmarkMetricItem("engagement_score", 99, "percent", null, 100)),
            ],
            ValidateOnly: null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // The index of the offending row comes back, so a two-hundred-row import can be fixed.
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var errors = body.RootElement.GetProperty("errors");
        Assert.Equal(1, errors.GetArrayLength());
        Assert.Equal(1, errors[0].GetProperty("index").GetInt32());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>
    /// The same refusal for another tenant's company id, which is the other half of
    /// <c>CanWriteBenchmark</c>.
    /// </summary>
    [Fact]
    public async Task Import_refuses_a_CompanyAdmins_item_scoped_to_another_company()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"import-cross-{Guid.NewGuid():N}";

        var response = await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [Item("Another tenant's row", _companyBId, category, new ImportBenchmarkMetricItem("engagement_score", 70, "percent", null, 100))],
            ValidateOnly: null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>
    /// A validate-only import is also refused, so it cannot be used to find out whether a
    /// company id exists.
    /// </summary>
    [Fact]
    public async Task Import_refuses_an_out_of_scope_item_even_when_it_would_write_nothing()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var response = await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [Item("Dry-run global row", null, $"import-dry-{Guid.NewGuid():N}")],
            ValidateOnly: true));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// A SuperAdmin's import lands: rows, their metrics, and a quality score computed on the
    /// way in by the same rule <c>validate</c> applies.
    ///
    /// <para>
    /// The imported rows are read back through the ordinary list and detail routes rather than
    /// out of the import response, because what the import returned and what the product now
    /// holds are different claims. The score is asserted against the rule -- a fully attributed,
    /// well-sampled three-metric row is 100 -- so an import that quietly wrote <c>pending</c>/0
    /// would fail here rather than wait for someone to notice.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Import_creates_global_benchmarks_with_their_metrics_and_scores_them()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"import-ok-{Guid.NewGuid():N}";

        var response = await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [
                new ImportBenchmarkItem(
                    "Sector engagement 2026", "vendor row", "industry", category, "vendor file",
                    "manufacturing", "201-500", "Costa Rica", null,
                    [
                        new ImportBenchmarkMetricItem("engagement_score", 70, "percent", 50, 900),
                        new ImportBenchmarkMetricItem("absence_rate", 3.4, "percent", 50, 900),
                        new ImportBenchmarkMetricItem("turnover_rate", 11.2, "percent", 50, 900),
                    ]),
                new ImportBenchmarkItem(
                    "Sector engagement 2025", "vendor row", "industry", category, "vendor file",
                    "manufacturing", "201-500", "Costa Rica", null,
                    [new ImportBenchmarkMetricItem("engagement_score", 66, "percent", 50, 900)]),
            ],
            ValidateOnly: null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<ImportBenchmarksResult>())!;
        Assert.True(result.Applied);
        Assert.Equal(2, result.Benchmarks);
        Assert.Equal(4, result.Metrics);

        var listed = (await (await client.GetAsync("/admin/benchmarks"))
            .Content.ReadFromJsonAsync<List<BenchmarkListItem>>())!
            .Where(b => b.Category == category)
            .ToList();
        Assert.Equal(2, listed.Count);
        Assert.All(listed, b => Assert.Null(b.CompanyId));
        // Nothing in a vendor file says anything about last year, and saying nothing is not the
        // same as saying there was nothing -- so `unlinked`, never `none`.
        Assert.All(listed, b => Assert.Equal(PriorPeriodStatuses.Unlinked, b.PriorPeriodStatus));

        var full = listed.Single(b => b.Name == "Sector engagement 2026");
        Assert.Equal(100d, full.QualityScore, 10);

        var detail = (await (await client.GetAsync($"/admin/benchmarks/{full.Id}"))
            .Content.ReadFromJsonAsync<BenchmarkDetail>())!;
        Assert.Equal(3, detail.Metrics.Count);
        Assert.Equal(BenchmarkValidationStatuses.Verified, detail.ValidationStatus);
        Assert.Equal(900, detail.Metrics.Single(m => m.MetricName == "engagement_score").SampleSize);
    }

    /// <summary>
    /// One malformed item fails the whole import.
    ///
    /// <para>
    /// A partial import is the worst of the available outcomes: the caller's file and the
    /// database now disagree about what happened, and the obvious remedy -- re-running the
    /// file -- duplicates everything that did land.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Import_is_all_or_nothing()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"import-partial-{Guid.NewGuid():N}";

        var response = await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [
                Item("Perfectly good row", null, category, new ImportBenchmarkMetricItem("engagement_score", 70, "percent", null, 100)),
                new ImportBenchmarkItem("Nameless", "", "industry", category, "vendor file", null, null, null, null, null),
            ],
            ValidateOnly: null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>A validate-only import scores every row and creates none of them.</summary>
    [Fact]
    public async Task Import_validate_only_reports_scores_without_writing()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"import-validate-only-{Guid.NewGuid():N}";

        var result = (await (await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [Item("Would-be row", null, category, new ImportBenchmarkMetricItem("engagement_score", 70, "percent", 50, 900))],
            ValidateOnly: true))).Content.ReadFromJsonAsync<ImportBenchmarksResult>())!;

        Assert.False(result.Applied);
        Assert.Equal(1, result.Benchmarks);
        var summary = Assert.Single(result.Created);
        Assert.Null(summary.Id);
        Assert.Equal(BenchmarkValidationStatuses.NeedsReview, summary.ValidationStatus);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>
    /// A field longer than its column is answered as a bad request, not as a broken server.
    ///
    /// <para>
    /// This is the ordinary shape of a real vendor file: a benchmark name that runs long. Left
    /// to the database it is a Postgres 22001 surfacing as a 500, which tells the person
    /// holding the file that the product is broken rather than that one row needs shortening.
    /// The status code IS the assertion here -- a 500 would also have written nothing, and
    /// asserting only "nothing was written" would pass on the defect.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Import_answers_an_over_long_field_with_a_bad_request_not_a_server_error()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"import-long-{Guid.NewGuid():N}";

        var response = await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [Item(new string('n', 201), null, category, new ImportBenchmarkMetricItem("engagement_score", 70, "percent", null, 100))],
            ValidateOnly: null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, body.RootElement.GetProperty("errors")[0].GetProperty("index").GetInt32());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>An import with nothing in it is a mistake, not an empty success.</summary>
    [Fact]
    public async Task Import_refuses_an_empty_payload()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest([], null))).StatusCode);
    }

    /// <summary>
    /// None of these routes are open to a non-admin.
    /// </summary>
    [Theory]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task The_analytical_routes_are_closed_to_everyone_below_a_CompanyAdmin(string role)
    {
        var admin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var category = $"below-{Guid.NewGuid():N}";
        var one = await CreateAsync(admin, "One", _companyAId, category: category);
        var two = await CreateAsync(admin, "Two", _companyAId, category: category);

        var client = await ClientAsync(role, _companyADomain, _companyAId);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/admin/benchmarks/categories")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/admin/benchmarks/compare?ids={one.Id},{two.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/admin/benchmarks/industry")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/admin/benchmarks/{one.Id}/trends")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync($"/admin/benchmarks/{one.Id}/validate", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [Item("Attempt", _companyAId, category)], null))).StatusCode);
    }

    // ===================================================================================
    // metrics that cannot be serialised, and payloads that are not shaped like payloads
    //
    // Everything below goes through raw JSON rather than the typed request records, and it
    // has to: `1e400` and `null` are the whole subject, and neither can be expressed by
    // constructing an ImportBenchmarkMetricItem -- System.Text.Json refuses to WRITE an
    // infinity, which is the second half of the bug being pinned.
    // ===================================================================================

    private static StringContent Json(string body) => new(body, Encoding.UTF8, "application/json");

    /// <summary>
    /// A metric percentile of <c>1e400</c> is refused, and the benchmark stays readable.
    ///
    /// <para>
    /// <c>1e400</c> is well-formed JSON and <c>System.Text.Json</c> deserialises it to
    /// <c>+Infinity</c> without complaint. Postgres stores an infinity in a
    /// <c>double precision</c> column happily. Serialising one back out throws, so the row
    /// would make this benchmark's detail route -- and every comparison naming it, and every
    /// sector containing it -- answer 500 from then on. There is no <c>MapDelete</c> anywhere
    /// on benchmarks or their metrics, so nothing in the product could undo it.
    /// </para>
    /// <para>
    /// The second half of the test is the half that matters. Asserting only the 400 would pass
    /// on a version that returned 400 for the wrong reason; reading the benchmark back
    /// afterwards asserts what the 400 was FOR, which is that this benchmark can still be
    /// read. <c>value</c> was guarded before this and <c>percentile</c> was not, and one
    /// unguarded double is not a smaller version of the same bug -- it is the whole bug.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Adding_a_metric_whose_percentile_is_not_a_finite_number_leaves_the_benchmark_readable()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(client, "Poisonable", _companyAId, category: $"nonfinite-{Guid.NewGuid():N}");
        await AddMetricAsync(client, subject.Id, "engagement_score", 70, "percent", percentile: 50, sampleSize: 100);

        var response = await client.PostAsync(
            $"/admin/benchmarks/{subject.Id}/metrics",
            Json("""{"metricName":"absence_rate","value":3.2,"unit":"percent","percentile":1e400,"sampleSize":100}"""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var detail = await client.GetAsync($"/admin/benchmarks/{subject.Id}");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        var body = (await detail.Content.ReadFromJsonAsync<BenchmarkDetail>())!;
        Assert.Equal("engagement_score", Assert.Single(body.Metrics).MetricName);
    }

    /// <summary>The same for the value, through the same door, which guarded neither.</summary>
    [Fact]
    public async Task Adding_a_metric_whose_value_is_not_a_finite_number_leaves_the_benchmark_readable()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(client, "Poisonable by value", _companyAId, category: $"nonfinite-{Guid.NewGuid():N}");

        var response = await client.PostAsync(
            $"/admin/benchmarks/{subject.Id}/metrics",
            Json("""{"metricName":"absence_rate","value":-1e400,"unit":"percent","percentile":null,"sampleSize":100}"""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/admin/benchmarks/{subject.Id}")).StatusCode);
    }

    /// <summary>
    /// <c>POST /{id}/metrics</c> validates the fields the import path validates.
    ///
    /// <para>
    /// It used to validate nothing at all: an over-long metric name reached Postgres as a
    /// 22001 and surfaced as a 500. The two doors run one shared rule now, so this asserts the
    /// door that was never asserted.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData("""{"metricName":"","value":1,"unit":"percent","percentile":null,"sampleSize":null}""")]
    [InlineData("""{"metricName":"engagement_score","value":1,"unit":"","percentile":null,"sampleSize":null}""")]
    public async Task Adding_a_metric_without_a_name_or_a_unit_is_a_bad_request(string body)
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(client, "Strict", _companyAId, category: $"metric-strict-{Guid.NewGuid():N}");

        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await client.PostAsync($"/admin/benchmarks/{subject.Id}/metrics", Json(body))).StatusCode);
    }

    /// <summary>An over-long metric name is answered before the insert, not by Postgres.</summary>
    [Fact]
    public async Task Adding_a_metric_with_an_over_long_name_is_a_bad_request_not_a_server_error()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(client, "Long metric", _companyAId, category: $"metric-long-{Guid.NewGuid():N}");

        var response = await client.PostAsJsonAsync(
            $"/admin/benchmarks/{subject.Id}/metrics",
            new AddBenchmarkMetricRequest(new string('m', 201), 1, "percent", null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>The import path refuses the same infinity, naming the row it came from.</summary>
    [Fact]
    public async Task Import_refuses_a_metric_percentile_that_is_not_a_finite_number()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"import-nonfinite-{Guid.NewGuid():N}";

        var response = await client.PostAsync("/admin/benchmarks/import", Json($$"""
            {"benchmarks":[
              {"name":"Fine row","description":"d","type":"industry","category":"{{category}}","source":"vendor file",
               "industry":"manufacturing","companySize":null,"region":null,"companyId":null,
               "metrics":[{"metricName":"engagement_score","value":70,"unit":"percent","percentile":50,"sampleSize":100}]},
              {"name":"Poisoned row","description":"d","type":"industry","category":"{{category}}","source":"vendor file",
               "industry":"manufacturing","companySize":null,"region":null,"companyId":null,
               "metrics":[{"metricName":"absence_rate","value":3.2,"unit":"percent","percentile":1e400,"sampleSize":100}]}
            ]}
            """));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, body.RootElement.GetProperty("errors")[0].GetProperty("index").GetInt32());

        // All or nothing: the good row above it did not land either.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>
    /// A null row and a null metric are bad requests naming the row, not 500s.
    ///
    /// <para>
    /// <c>[null]</c> and <c>"metrics":[null]</c> are both well-formed JSON that bind to null
    /// elements, and the handler dereferenced them. This is the same class of failure the
    /// over-long-field check was written to close: a malformed vendor file has to come back as
    /// a bad request naming the row, because "An unexpected error occurred" tells the person
    /// holding the file that the product is broken rather than that row two needs looking at.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Import_answers_a_null_row_with_a_bad_request_naming_it()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"import-nullrow-{Guid.NewGuid():N}";

        var response = await client.PostAsync("/admin/benchmarks/import", Json($$"""
            {"benchmarks":[
              {"name":"Fine row","description":"d","type":"industry","category":"{{category}}","source":"vendor file",
               "industry":"manufacturing","companySize":null,"region":null,"companyId":null,
               "metrics":[{"metricName":"engagement_score","value":70,"unit":"percent","percentile":50,"sampleSize":100}]},
              null
            ]}
            """));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, body.RootElement.GetProperty("errors")[0].GetProperty("index").GetInt32());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>The same one level down, inside a row's metric list.</summary>
    [Fact]
    public async Task Import_answers_a_null_metric_with_a_bad_request_naming_its_row()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"import-nullmetric-{Guid.NewGuid():N}";

        var response = await client.PostAsync("/admin/benchmarks/import", Json($$"""
            {"benchmarks":[
              {"name":"Row with a hole in it","description":"d","type":"industry","category":"{{category}}","source":"vendor file",
               "industry":"manufacturing","companySize":null,"region":null,"companyId":null,
               "metrics":[null]}
            ]}
            """));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, body.RootElement.GetProperty("errors")[0].GetProperty("index").GetInt32());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Category == category).ToListAsync());
    }

    /// <summary>
    /// EVERY over-long field is answered at the door, not only <c>Name</c>.
    ///
    /// <para>
    /// There are eight length checks and one of them was asserted. Relaxing any of the other
    /// seven by a factor of a thousand left the whole suite green, which means seven of the
    /// eight limits were decoration: a vendor file with a long <c>description</c> or a long
    /// <c>region</c> would have reached Postgres and come back as a 500 exactly as before the
    /// check was written. One case per field, each named by the message so a relaxed limit
    /// fails on its own field rather than on a neighbour's.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData("Name", 201)]
    [InlineData("Description", 2001)]
    [InlineData("Type", 21)]
    [InlineData("Category", 101)]
    [InlineData("Source", 201)]
    [InlineData("Industry", 101)]
    [InlineData("CompanySize", 51)]
    [InlineData("Region", 101)]
    public async Task Import_answers_any_over_long_field_with_a_bad_request_naming_the_field(string field, int length)
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"long-{field}-{Guid.NewGuid():N}";
        var tooLong = new string('x', length);

        // One item, well-formed apart from the single field under test. `category` doubles as
        // this test's isolation token, so the Category case gets its own long value and the
        // "nothing was written" assertion below then matches on the name instead.
        var name = $"Long {field} {Guid.NewGuid():N}";
        var item = new ImportBenchmarkItem(
            Name: field == "Name" ? tooLong : name,
            Description: field == "Description" ? tooLong : "d",
            Type: field == "Type" ? tooLong : "industry",
            Category: field == "Category" ? tooLong : category,
            Source: field == "Source" ? tooLong : "vendor file",
            Industry: field == "Industry" ? tooLong : "manufacturing",
            CompanySize: field == "CompanySize" ? tooLong : null,
            Region: field == "Region" ? tooLong : null,
            CompanyId: null,
            Metrics: [new ImportBenchmarkMetricItem("engagement_score", 70, "percent", 50, 100)]);

        var response = await client.PostAsJsonAsync(
            "/admin/benchmarks/import", new ImportBenchmarksRequest([item], ValidateOnly: null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var error = body.RootElement.GetProperty("errors")[0];
        Assert.Equal(0, error.GetProperty("index").GetInt32());
        // The message names the field. Without this the theory would pass on any 400 at all --
        // including one produced by a different field's limit -- and seven of the eight cases
        // would assert nothing about their own field.
        Assert.StartsWith(field, error.GetProperty("message").GetString());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Empty(await db.Benchmarks.AsNoTracking().Where(b => b.Name == name || b.Category == category).ToListAsync());
    }

    // ===================================================================================
    // the quality rule's two counting rules
    // ===================================================================================

    /// <summary>
    /// One metric recorded at three percentiles is ONE metric, not three.
    ///
    /// <para>
    /// This is the ordinary shape of a real benchmark -- a single measure reported at p25, p50
    /// and p75 -- and it is the fixture that separates the rule the code runs from the rule the
    /// code publishes. <c>FullMetricCount</c>'s own summary, the decision record's table and
    /// #90 all say DISTINCT metrics; the handler counted readings, so this benchmark scored
    /// 3/3 on a component worth a fifth of the total and came out at 86.7, <c>verified</c>.
    /// Counting distinct names it is 1/3, 66.7, <c>needs-review</c> -- a badge a client sees,
    /// moved by which of two readings of one sentence the code took.
    /// </para>
    /// <para>
    /// The other two per-reading components are asserted in the same breath, because the fix
    /// is not "count distinct everywhere": every stored reading still has to state its own
    /// sample and its own percentile, and scoring those per distinct name would let one
    /// answered reading cover for two unanswered ones.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Validate_counts_one_metric_at_three_percentiles_as_one_metric()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var subject = await CreateAsync(
            client, "Three percentiles of one thing", _companyAId,
            category: $"validate-distinct-{Guid.NewGuid():N}", industry: "manufacturing");

        foreach (var (percentile, value) in new[] { (25d, 61d), (50d, 70d), (75d, 79d) })
        {
            await AddMetricAsync(client, subject.Id, "engagement_score", value, "percent", percentile: percentile, sampleSize: 500);
        }

        var result = (await (await client.PostAsync($"/admin/benchmarks/{subject.Id}/validate", null))
            .Content.ReadFromJsonAsync<BenchmarkValidationResult>())!;

        var metrics = result.Components.Single(c => c.Name == BenchmarkQuality.ComponentMetrics);
        Assert.Equal(1, metrics.Satisfied);
        Assert.Equal(BenchmarkQuality.FullMetricCount, metrics.Total);

        // Per READING, and there are three of them.
        Assert.Equal(3, result.Components.Single(c => c.Name == BenchmarkQuality.ComponentSampleSize).Satisfied);
        Assert.Equal(3, result.Components.Single(c => c.Name == BenchmarkQuality.ComponentSampleSize).Total);
        Assert.Equal(3, result.Components.Single(c => c.Name == BenchmarkQuality.ComponentDistribution).Satisfied);

        // 0.10 + 0.25 + 0.15 + 0.066667 + 0.10, times 100. Counting readings it is 86.7.
        Assert.Equal(66.7d, result.QualityScore, 10);
        Assert.Equal(BenchmarkValidationStatuses.NeedsReview, result.Status);
        Assert.Equal(result.QualityScore, Math.Round(result.Components.Sum(c => c.WeightedScore) * 100d, 1), 10);
    }

    /// <summary>
    /// The reportable-sample floor is thirty, and twenty-nine is below it.
    ///
    /// <para>
    /// The floor was asserted only against an absent sample size, so any floor at all -- one
    /// included -- satisfied the suite, and "a benchmark built from six responses ends up
    /// labelled verified" was the failure the constant exists to prevent. Both sides of the
    /// boundary are exercised: twenty-nine counts for nothing, thirty counts.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Validate_does_not_credit_a_sample_below_the_reportable_floor()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var token = Guid.NewGuid().ToString("N");

        var thin = await CreateAsync(client, "Twenty-nine", _companyAId, category: $"floor-under-{token}", industry: "manufacturing");
        await AddMetricAsync(client, thin.Id, "engagement_score", 74, "percent", percentile: 60, sampleSize: BenchmarkQuality.ReportableSampleSize - 1);
        await AddMetricAsync(client, thin.Id, "absence_rate", 3.2, "percent", percentile: 40, sampleSize: BenchmarkQuality.ReportableSampleSize - 1);

        var under = (await (await client.PostAsync($"/admin/benchmarks/{thin.Id}/validate", null))
            .Content.ReadFromJsonAsync<BenchmarkValidationResult>())!;

        Assert.Equal(0, under.Components.Single(c => c.Name == BenchmarkQuality.ComponentSampleSize).Satisfied);
        // 0.20 + 0 + 0.15 + 0.066667 + 0.10. With the floor at one it is 76.7 and `verified`.
        Assert.Equal(51.7d, under.QualityScore, 10);
        Assert.Equal(BenchmarkValidationStatuses.NeedsReview, under.Status);

        var atFloor = await CreateAsync(client, "Exactly thirty", _companyAId, category: $"floor-at-{token}", industry: "manufacturing");
        await AddMetricAsync(client, atFloor.Id, "engagement_score", 74, "percent", percentile: 60, sampleSize: BenchmarkQuality.ReportableSampleSize);
        await AddMetricAsync(client, atFloor.Id, "absence_rate", 3.2, "percent", percentile: 40, sampleSize: BenchmarkQuality.ReportableSampleSize);

        var at = (await (await client.PostAsync($"/admin/benchmarks/{atFloor.Id}/validate", null))
            .Content.ReadFromJsonAsync<BenchmarkValidationResult>())!;

        Assert.Equal(2, at.Components.Single(c => c.Name == BenchmarkQuality.ComponentSampleSize).Satisfied);
        Assert.Equal(76.7d, at.QualityScore, 10);
    }

    // ===================================================================================
    // the sector, past the one fixture shape every earlier test used
    // ===================================================================================

    /// <summary>
    /// A sector is made of industry benchmarks. A company's own internal targets are not in it.
    ///
    /// <para>
    /// The decision record is explicit that <c>type</c> must not be defaulted from the subject,
    /// because an internal benchmark's sector is made of industry rows. Applying no filter at
    /// all had the same effect the record forbids, one door along: this company's own internal
    /// target -- a number it set for itself -- was averaged into the industry mean it is being
    /// measured against, dragging the sector toward the company and shrinking the gap the
    /// reading exists to show.
    /// </para>
    /// <para>
    /// Every fixture in this suite before now used <c>type: "industry"</c>, so no test could
    /// see it. The internal row here reads 10 against a sector of 70s: if it were counted the
    /// mean would be 50.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_does_not_average_an_internal_benchmark_into_the_sector()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var token = Guid.NewGuid().ToString("N");
        var industry = $"typed-{token}";
        var category = $"typed-{token}";

        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        foreach (var value in new[] { 60d, 80d })
        {
            var peer = await CreateAsync(superAdmin, $"Sector {value}", null, category: category, type: BenchmarkTypes.Industry, industry: industry);
            await AddMetricAsync(superAdmin, peer.Id, "engagement_score", value, "percent", sampleSize: 100);
        }

        var ourTarget = await CreateAsync(client, "Our internal target", _companyAId, category: category, type: BenchmarkTypes.Internal, industry: industry);
        await AddMetricAsync(client, ourTarget.Id, "engagement_score", 10, "percent", sampleSize: 100);

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?industry={industry}&category={category}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        Assert.Equal(BenchmarkTypes.Industry, result.Filters.Type);
        Assert.Equal(2, result.BenchmarkCount);
        var metric = Assert.Single(result.Metrics);
        Assert.Equal(2, metric.BenchmarkCount);
        Assert.Equal(70d, metric.Mean, 10);
        Assert.Equal(60d, metric.Min, 10);
        Assert.Equal(80d, metric.Max, 10);

        // And it is still reachable when asked for by name -- the default narrows, it does not
        // hide the rows.
        var internalOnly = (await (await client.GetAsync(
                $"/admin/benchmarks/industry?industry={industry}&category={category}&type={BenchmarkTypes.Internal}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;
        Assert.Equal(1, internalOnly.BenchmarkCount);
        Assert.Equal(10d, Assert.Single(internalOnly.Metrics).Mean, 10);
    }

    /// <summary>
    /// A deactivated benchmark is not in the sector.
    ///
    /// <para>
    /// <b>Named exception.</b> This test writes <c>is_active = false</c> through the DbContext
    /// because no route deactivates a benchmark -- the decision record says so and left the
    /// behaviour untested for that reason. Leaving it untested is what let the filter be
    /// deleted outright with the suite still green, and the behaviour is real: the sector query
    /// carries <c>Where(b =&gt; b.IsActive)</c> and every other benchmark route respects the
    /// column. The row this writes is one the product's own default already produces -- the
    /// column exists, is indexed, and is written <c>true</c> on every create -- so this is a
    /// state the schema holds rather than a payload invented to satisfy an assertion.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_leaves_a_deactivated_benchmark_out_of_the_sector()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var token = Guid.NewGuid().ToString("N");
        var industry = $"inactive-{token}";
        var category = $"inactive-{token}";

        foreach (var value in new[] { 60d, 80d })
        {
            var peer = await CreateAsync(client, $"Active {value}", null, category: category, industry: industry);
            await AddMetricAsync(client, peer.Id, "engagement_score", value, "percent", sampleSize: 100);
        }

        var retired = await CreateAsync(client, "Retired", null, category: category, industry: industry);
        await AddMetricAsync(client, retired.Id, "engagement_score", 10, "percent", sampleSize: 100);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.Benchmarks.FirstAsync(b => b.Id == retired.Id);
            row.IsActive = false;
            await db.SaveChangesAsync();
        }

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?industry={industry}&category={category}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        Assert.Equal(2, result.BenchmarkCount);
        // 70, not 50. The retired row's 10 is not in the mean.
        Assert.Equal(70d, Assert.Single(result.Metrics).Mean, 10);
    }

    /// <summary>
    /// The median of an even-sized sector is the mean of the middle two, not the upper one.
    ///
    /// <para>
    /// Every sector fixture in this suite had an odd number of peers, so the even branch was
    /// never taken. The values are chosen so all three candidate answers differ: the median is
    /// 25, the upper middle is 30, and the mean is 40.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_takes_the_median_of_an_even_sector_from_both_middle_values()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var token = Guid.NewGuid().ToString("N");
        var industry = $"even-{token}";
        var category = $"even-{token}";

        foreach (var value in new[] { 10d, 20d, 30d, 100d })
        {
            var peer = await CreateAsync(client, $"Even {value}", null, category: category, industry: industry);
            await AddMetricAsync(client, peer.Id, "engagement_score", value, "percent", sampleSize: 100);
        }

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?industry={industry}&category={category}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        var metric = Assert.Single(result.Metrics);
        Assert.Equal(4, metric.BenchmarkCount);
        Assert.Equal(25d, metric.Median, 10);
        Assert.Equal(40d, metric.Mean, 10);
    }

    /// <summary>
    /// A peer reading exactly what the subject reads is not below it.
    ///
    /// <para>
    /// The percentile rank is documented as "the share of peers reading STRICTLY below the
    /// subject". The boundary -- a peer equal to the subject -- had no fixture, so counting
    /// equals as below was indistinguishable. With peers at 60, 75 and 80 and a subject at 75,
    /// strictly-below is one in three; counting the equal peer makes it two in three, which
    /// moves a company from the bottom third of its sector to the top.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_does_not_count_a_peer_equal_to_the_subject_as_below_it()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var token = Guid.NewGuid().ToString("N");
        var industry = $"tie-{token}";
        var category = $"tie-{token}";

        foreach (var value in new[] { 60d, 75d, 80d })
        {
            var peer = await CreateAsync(client, $"Tie {value}", null, category: category, industry: industry);
            await AddMetricAsync(client, peer.Id, "engagement_score", value, "percent", sampleSize: 100);
        }

        var subject = await CreateAsync(client, "Us, level with a peer", _companyAId, category: category, industry: industry);
        await AddMetricAsync(client, subject.Id, "engagement_score", 75, "percent", sampleSize: 100);

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?benchmarkId={subject.Id}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        var metric = Assert.Single(result.Metrics);
        Assert.Equal(3, metric.BenchmarkCount);
        Assert.Equal(100d / 3d, metric.SubjectPercentileRank!.Value, 10);
    }

    /// <summary>
    /// One benchmark contributes one sample, not one per reading.
    ///
    /// <para>
    /// The mean beside it already counts a benchmark once however many times it records a
    /// metric -- that is the "one benchmark, one vote" rule the route's own remarks state --
    /// while <c>totalSampleSize</c> summed every reading. A benchmark reporting one metric at
    /// p25, p50 and p75 off a survey of a hundred people therefore claimed three hundred
    /// people, and <c>totalSampleSize</c> is the field a reader uses to decide whether to
    /// believe the mean.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_counts_one_benchmarks_sample_once_however_many_readings_it_has()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var token = Guid.NewGuid().ToString("N");
        var industry = $"sample-{token}";
        var category = $"sample-{token}";

        var peer = await CreateAsync(client, "One survey, three percentiles", null, category: category, industry: industry);
        foreach (var (percentile, value) in new[] { (25d, 70d), (50d, 75d), (75d, 80d) })
        {
            await AddMetricAsync(client, peer.Id, "engagement_score", value, "percent", percentile: percentile, sampleSize: 100);
        }

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?industry={industry}&category={category}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        var metric = Assert.Single(result.Metrics);
        Assert.Equal(1, metric.BenchmarkCount);
        Assert.Equal(75d, metric.Mean, 10);
        // A hundred people were asked, once. Summing the readings claims three hundred.
        Assert.Equal(100, metric.TotalSampleSize);
    }

    /// <summary>
    /// A cleared industry box is an absent filter, not an empty one, and the subject still
    /// supplies the default.
    ///
    /// <para>
    /// <c>?benchmarkId=X&amp;industry=</c> is what a form submits for a field the user cleared.
    /// The empty string is not null, so it beat the <c>??=</c> default and the subject's own
    /// industry was never applied; it was then blanked to null, so no filter was applied
    /// either. The sector silently widened to every industry at the exact moment a user tried
    /// to narrow it. The peer here is in a different industry: if it is counted, the sector is
    /// two.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_treats_a_cleared_industry_box_as_absent_and_still_defaults_from_the_subject()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var token = Guid.NewGuid().ToString("N");
        var ours = $"ours-{token}";
        var theirs = $"theirs-{token}";
        var category = $"cleared-{token}";

        var peer = await CreateAsync(client, "Same industry peer", null, category: category, industry: ours);
        await AddMetricAsync(client, peer.Id, "engagement_score", 60, "percent", sampleSize: 100);
        var stranger = await CreateAsync(client, "Another industry entirely", null, category: category, industry: theirs);
        await AddMetricAsync(client, stranger.Id, "engagement_score", 90, "percent", sampleSize: 100);

        var subject = await CreateAsync(client, "Us", _companyAId, category: category, industry: ours);
        await AddMetricAsync(client, subject.Id, "engagement_score", 70, "percent", sampleSize: 100);

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?benchmarkId={subject.Id}&industry="))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        Assert.Equal(ours, result.Filters.Industry);
        Assert.Equal(1, result.BenchmarkCount);
        Assert.Equal(60d, Assert.Single(result.Metrics).Mean, 10);
    }

    /// <summary>
    /// The first company in its sector still gets its own reading back.
    ///
    /// <para>
    /// With no peers every aggregate is empty, and the response was
    /// <c>benchmarkCount: 0, metrics: []</c> -- identical to the response for a benchmark that
    /// records nothing at all. "You are the first company here, and this is your number" and
    /// "there is no data" are different things to put in front of a client, and every tenant
    /// begins in the first state, the demo one included.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Industry_returns_the_subjects_own_reading_when_it_has_no_peers()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var token = Guid.NewGuid().ToString("N");

        var subject = await CreateAsync(client, "First in our sector", _companyAId, category: $"lonely-{token}", industry: $"lonely-{token}");
        await AddMetricAsync(client, subject.Id, "engagement_score", 72, "percent", percentile: 50, sampleSize: 240);

        var result = (await (await client.GetAsync($"/admin/benchmarks/industry?benchmarkId={subject.Id}"))
            .Content.ReadFromJsonAsync<BenchmarkIndustryResult>())!;

        Assert.Equal(0, result.BenchmarkCount);
        Assert.Empty(result.Metrics);
        Assert.Equal(subject.Id, result.Subject!.Id);

        var own = Assert.Single(result.SubjectMetrics);
        Assert.Equal("engagement_score", own.MetricName);
        Assert.Equal(72d, own.Value, 10);
        Assert.Equal("percent", own.Unit);
        Assert.Equal(240, own.SampleSize);
    }

    /// <summary>
    /// A category summary reports how many of its benchmarks are active and what they average.
    ///
    /// <para>
    /// <c>averageQualityScore</c> is the field the whole quality rule exists to feed -- the
    /// benchmarks page charts it per category, and before #90 it was a chart of a constant
    /// zero. Neither it nor <c>activeCount</c> was asserted anywhere, so both could return any
    /// number at all. The fixture is built through <c>import</c>, which scores on the way in,
    /// and the two scores are chosen to make the mean exact and unlike the row count: a fully
    /// described, well-sampled three-metric row is 100, and the same row with neither sample
    /// sizes nor percentiles is 60, so the average is 80.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Categories_reports_the_active_count_and_the_average_quality_score()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var category = $"cat-quality-{Guid.NewGuid():N}";

        ImportBenchmarkItem Row(string name, double? percentile, int? sampleSize) => new(
            name, "d", BenchmarkTypes.Industry, category, "vendor file",
            "manufacturing", "201-500", "Costa Rica", null,
            [
                new ImportBenchmarkMetricItem("engagement_score", 70, "percent", percentile, sampleSize),
                new ImportBenchmarkMetricItem("absence_rate", 3.4, "percent", percentile, sampleSize),
                new ImportBenchmarkMetricItem("turnover_rate", 11.2, "percent", percentile, sampleSize),
            ]);

        var imported = await client.PostAsJsonAsync("/admin/benchmarks/import", new ImportBenchmarksRequest(
            [Row("Fully described", 50, 900), Row("Unsourced and unplaced", null, null)], ValidateOnly: null));
        Assert.Equal(HttpStatusCode.Created, imported.StatusCode);

        var scores = (await imported.Content.ReadFromJsonAsync<ImportBenchmarksResult>())!.Created;
        Assert.Equal(100d, scores.Single(s => s.Name == "Fully described").QualityScore, 10);
        Assert.Equal(60d, scores.Single(s => s.Name == "Unsourced and unplaced").QualityScore, 10);

        var summary = (await (await client.GetAsync("/admin/benchmarks/categories"))
            .Content.ReadFromJsonAsync<List<BenchmarkCategorySummary>>())!
            .Single(s => s.Category == category);

        Assert.Equal(2, summary.BenchmarkCount);
        Assert.Equal(2, summary.ActiveCount);
        Assert.Equal(2, summary.GlobalCount);
        // 80, which is neither of the two scores and not the number of rows.
        Assert.Equal(80d, summary.AverageQualityScore, 10);
    }
}
