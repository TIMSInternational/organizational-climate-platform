using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Dashboard;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Dashboard;

/// <summary>
/// <c>GET /dashboard/employee/last-outcome</c> — "what came of the last one", and mostly
/// what it refuses to say.
///
/// <para>
/// The fixture is built so that every wrong answer is a <em>different number</em> rather
/// than an absent one. The tenant under test holds three closed-or-open surveys whose
/// response profiles disagree on purpose — the latest closed one has 14 completed answers
/// across three departments, the older closed one has 6 across one, the still-open one has
/// 7 across one — so picking the wrong survey cannot coincidentally produce the right body.
/// A second tenant closes a survey <em>more recently</em> than any of them, which is the
/// row a query missing its company predicate would return.
/// </para>
///
/// <para>
/// <b>The disclosure property this file exists for.</b> One department (Finance) has four
/// completed responses against a floor of five, so it is suppressed in the shared
/// aggregation. It must contribute to <c>protectedDepartmentCount</c> and it must appear
/// nowhere else — not by name, not by id, and not by size. It is given a name unique to
/// this run so that a substring search over the raw body is a real assertion rather than a
/// hope, and it is also given an <em>open action plan</em>, because the plan list is the
/// second door its name could walk out of and the one a projection is most likely to
/// forget.
/// </para>
/// </summary>
[Collection("Postgres")]
public class EmployeeLastOutcomeEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _token = Guid.NewGuid().ToString("N")[..8];
    private readonly string _companyADomain = $"loa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"lob-{Guid.NewGuid():N}.test";
    private readonly string _companyCDomain = $"loc-{Guid.NewGuid():N}.test";

    /// <summary>Completed responses from the department that stays below the floor.</summary>
    private const int ProtectedDepartmentRespondents = 4;

    /// <summary>Completed responses to the latest closed survey: 5 + 5 + 4, across three departments.</summary>
    private const int LatestClosedResponseCount = 14;

    private string EngineeringName => $"Engineering-{_token}";
    private string OperationsName => $"Operations-{_token}";

    /// <summary>The department that must never be named. Distinctive on purpose.</summary>
    private string ProtectedName => $"Finance-{_token}";

    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _companyCId;
    private Guid _engineeringId;
    private Guid _operationsId;
    private Guid _protectedDepartmentId;
    private Guid _latestClosedSurveyId;
    private Guid _olderClosedSurveyId;
    private Guid _openSurveyId;
    private Guid _otherTenantClosedSurveyId;
    private DateTimeOffset _latestClosedOn;

    public EmployeeLastOutcomeEndpointTests(PostgresContainerFixture postgres)
    {
        // The collection's shared host, not a per-class factory: xUnit builds a new class
        // instance per [Fact], so `new AuthWebApplicationFactory(...)` here is one host per
        // test CASE -- the #279 pattern the HostBudget guard in CreateHost refuses. This
        // class predates that conversion on a different lineage; the guard caught the
        // combination when main was merged into this branch.
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        // Truncated to whole milliseconds. `timestamptz` stores microseconds and
        // DateTimeOffset counts 100ns ticks, so an untruncated `UtcNow` comes back from the
        // database a few ticks short and an equality assertion on the close date fails for
        // a reason that has nothing to do with this endpoint.
        var clock = DateTimeOffset.UtcNow;
        var now = new DateTimeOffset(clock.Ticks - (clock.Ticks % TimeSpan.TicksPerMillisecond), clock.Offset);
        _latestClosedOn = now.AddDays(-10);

        var companyA = Company("Last Outcome Co A", _companyADomain, now);
        var companyB = Company("Last Outcome Co B", _companyBDomain, now);
        var companyC = Company("Last Outcome Co C", _companyCDomain, now);
        db.Companies.AddRange(companyA, companyB, companyC);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        _companyCId = companyC.Id;
        await db.SaveChangesAsync();

        var engineering = Department(companyA.Id, EngineeringName, now);
        var operations = Department(companyA.Id, OperationsName, now);
        var finance = Department(companyA.Id, ProtectedName, now);
        var otherTenantDepartment = Department(companyB.Id, $"Marketing-{_token}", now);
        db.Departments.AddRange(engineering, operations, finance, otherTenantDepartment);
        _engineeringId = engineering.Id;
        _operationsId = operations.Id;
        _protectedDepartmentId = finance.Id;
        await db.SaveChangesAsync();

        var authorA = await SeedUserAsync(db, companyA.Id, engineering.Id);
        var authorB = await SeedUserAsync(db, companyB.Id, otherTenantDepartment.Id);
        var authorC = await SeedUserAsync(db, companyC.Id, null);

        // Company A's three surveys. The open one closes LATER than either closed one, so a
        // lookup that sorted by EndDate without filtering on status would return it.
        _latestClosedSurveyId = await SeedSurveyAsync(
            db, companyA.Id, authorA, $"Q3 Climate-{_token}", SurveyStatuses.Closed, _latestClosedOn);
        _olderClosedSurveyId = await SeedSurveyAsync(
            db, companyA.Id, authorA, $"Q2 Climate-{_token}", SurveyStatuses.Closed, now.AddDays(-90));
        _openSurveyId = await SeedSurveyAsync(
            db, companyA.Id, authorA, $"Q4 Climate-{_token}", SurveyStatuses.Active, now.AddDays(6));

        // Company B closes a survey more recently than anything in A.
        _otherTenantClosedSurveyId = await SeedSurveyAsync(
            db, companyB.Id, authorB, $"Other tenant-{_token}", SurveyStatuses.Closed, now.AddDays(-1));

        // Company C has never closed anything.
        await SeedSurveyAsync(db, companyC.Id, authorC, $"C is still open-{_token}", SurveyStatuses.Active, now.AddDays(20));

        // The latest closed survey: five from Engineering, five from Operations, four from
        // Finance — one short of the floor, which is what makes it protected. Plus one
        // INCOMPLETE Engineering response, which is not participation and must not count.
        await SeedResponsesAsync(db, _latestClosedSurveyId, companyA.Id, engineering.Id, 5, isComplete: true);
        await SeedResponsesAsync(db, _latestClosedSurveyId, companyA.Id, operations.Id, 5, isComplete: true);
        await SeedResponsesAsync(
            db, _latestClosedSurveyId, companyA.Id, finance.Id, ProtectedDepartmentRespondents, isComplete: true);
        await SeedResponsesAsync(db, _latestClosedSurveyId, companyA.Id, engineering.Id, 1, isComplete: false);

        // Deliberately different profiles, so a wrong survey yields a wrong number.
        await SeedResponsesAsync(db, _olderClosedSurveyId, companyA.Id, engineering.Id, 6, isComplete: true);
        await SeedResponsesAsync(db, _openSurveyId, companyA.Id, engineering.Id, 7, isComplete: true);
        await SeedResponsesAsync(db, _otherTenantClosedSurveyId, companyB.Id, otherTenantDepartment.Id, 8, isComplete: true);

        // Three open plans opened since the latest closed survey — one named, one belonging
        // to the protected department, one company-wide — plus three that must not count.
        await SeedActionPlanAsync(db, companyA.Id, engineering.Id, authorA, "in_progress", now.AddDays(-8));
        await SeedActionPlanAsync(db, companyA.Id, finance.Id, authorA, "not_started", now.AddDays(-7));
        await SeedActionPlanAsync(db, companyA.Id, null, authorA, "in_progress", now.AddDays(-6));
        await SeedActionPlanAsync(db, companyA.Id, engineering.Id, authorA, "in_progress", now.AddDays(-40));
        await SeedActionPlanAsync(db, companyA.Id, engineering.Id, authorA, "completed", now.AddDays(-5));
        await SeedActionPlanAsync(db, companyB.Id, otherTenantDepartment.Id, authorB, "in_progress", now.AddDays(-4));
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    private static Company Company(string name, string emailDomain, DateTimeOffset now)
        => new() { Id = Guid.NewGuid(), Name = name, EmailDomain = emailDomain, CreatedAt = now };

    private static Department Department(Guid companyId, string name, DateTimeOffset now)
        => new() { Id = Guid.NewGuid(), CompanyId = companyId, Name = name, CreatedAt = now, UpdatedAt = now };

    private static async Task<Guid> SeedUserAsync(ClimateProjectDbContext db, Guid companyId, Guid? departmentId)
    {
        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            DepartmentId = departmentId,
            Email = $"seed-{Guid.NewGuid():N}@seed.test",
            Name = "Seed User",
            Role = Roles.Employee,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private static async Task<Guid> SeedSurveyAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        Guid createdBy,
        string title,
        string status,
        DateTimeOffset endDate)
    {
        var now = DateTimeOffset.UtcNow;
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEn = title,
            TitleEs = $"{title} (ES)",
            Language = "both",
            Type = "general_climate",
            StartDate = endDate.AddDays(-14),
            EndDate = endDate,
            Status = status,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return survey.Id;
    }

    private static async Task SeedResponsesAsync(
        ClimateProjectDbContext db, Guid surveyId, Guid companyId, Guid departmentId, int count, bool isComplete)
    {
        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < count; i++)
        {
            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                CompanyId = companyId,
                DepartmentId = departmentId,
                SessionId = Guid.NewGuid().ToString("N"),
                IsComplete = isComplete,
                IsAnonymous = true,
                StartTime = now,
                CompletionTime = isComplete ? now : null,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }

        await db.SaveChangesAsync();
    }

    private static async Task SeedActionPlanAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        Guid? departmentId,
        Guid createdBy,
        string status,
        DateTimeOffset createdAt)
    {
        db.ActionPlans.Add(new ActionPlan
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            DepartmentId = departmentId,
            CreatedBy = createdBy,
            Title = "Plan",
            Description = "Plan description",
            Status = status,
            DueDate = createdAt.AddDays(60),
            CreatedAt = createdAt,
            UpdatedAt = createdAt,
        });
        await db.SaveChangesAsync();
    }

    // ------------------------------------------------------------------
    // Auth helper
    // ------------------------------------------------------------------

    /// <param name="clearCompany">
    /// NULL company is GLOBAL scope in this schema, never "no scope", so it is set
    /// explicitly and only where a test is deliberately exercising that case. Signup binds
    /// the new user to whichever company owns the email domain, so a test about a
    /// company-less user has to undo that rather than merely omit an argument.
    /// </param>
    private async Task<HttpClient> ClientAsync(
        string role,
        string emailDomain,
        Guid? companyId = null,
        Guid? departmentId = null,
        bool clearCompany = false)
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
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }

            if (clearCompany)
            {
                user.CompanyId = null;
            }

            user.DepartmentId = departmentId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    // ------------------------------------------------------------------
    // Reachability and content
    // ------------------------------------------------------------------

    /// <summary>
    /// A plain employee may read it. There is no role gate, deliberately — every figure is
    /// scoped to the company on the caller's own row — so this is the assertion that would
    /// fail if one were ever added.
    /// </summary>
    [Fact]
    public async Task An_employee_may_read_what_came_of_the_last_survey()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        var response = await client.GetAsync("/dashboard/employee/last-outcome?lang=en");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<EmployeeLastOutcome>())!;

        Assert.Equal(_latestClosedSurveyId, body.SurveyId);
        Assert.Equal($"Q3 Climate-{_token}", body.SurveyTitle);
        Assert.Equal(_latestClosedOn, body.ClosedOn);

        // 5 + 5 + 4 completed. The sixth Engineering response is incomplete and is not
        // participation, so 15 here would mean partial responses are being counted.
        Assert.Equal(LatestClosedResponseCount, body.ResponseCount);

        // Three departments answered, one of them below the floor.
        Assert.Equal(3, body.DepartmentCount);
        Assert.Equal(1, body.ProtectedDepartmentCount);
        Assert.Equal(SurveyResultsPrivacy.MinimumSegmentRespondents, body.MinimumGroupSize);

        // Three plans opened since it closed and still open: the one predating the close and
        // the completed one are neither.
        Assert.Equal(3, body.OpenPlanCount);
        Assert.Equal(3, body.PlansOpenedSince.Count);
        Assert.Equal(EngineeringName, body.PlansOpenedSince[0].DepartmentName);
        Assert.True(
            body.PlansOpenedSince.SequenceEqual(body.PlansOpenedSince.OrderBy(p => p.CreatedAt)),
            "plans opened since the close are listed oldest first");
    }

    /// <summary>
    /// The panel is about the last survey that <em>closed</em>, and about this tenant.
    ///
    /// <para>
    /// Three wrong answers are available and each is seeded to be distinguishable: the
    /// still-open survey has the latest end date of the three in this company, the older
    /// closed one is the obvious result of a sort in the wrong direction, and another
    /// tenant's survey closed more recently than any of them.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_panel_reports_the_latest_closed_survey_and_never_an_open_one()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _operationsId);

        var response = await client.GetAsync("/dashboard/employee/last-outcome");
        var body = (await response.Content.ReadFromJsonAsync<EmployeeLastOutcome>())!;

        Assert.Equal(_latestClosedSurveyId, body.SurveyId);
        Assert.NotEqual(_openSurveyId, body.SurveyId);
        Assert.NotEqual(_olderClosedSurveyId, body.SurveyId);
        Assert.NotEqual(_otherTenantClosedSurveyId, body.SurveyId);

        // And the figures are that survey's, not another's: the open survey would report 7
        // answers across one department and the older closed one 6 across one.
        Assert.Equal(LatestClosedResponseCount, body.ResponseCount);
        Assert.Equal(3, body.DepartmentCount);

        // The other tenant reads its own, which is what makes the assertions above about
        // scope rather than about there being nothing else in the database.
        var otherTenant = await ClientAsync(Roles.Employee, _companyBDomain, _companyBId);
        var theirs = (await (await otherTenant.GetAsync("/dashboard/employee/last-outcome")).Content
            .ReadFromJsonAsync<EmployeeLastOutcome>())!;
        Assert.Equal(_otherTenantClosedSurveyId, theirs.SurveyId);
        Assert.Equal(8, theirs.ResponseCount);
    }

    // ------------------------------------------------------------------
    // Disclosure control
    // ------------------------------------------------------------------

    /// <summary>
    /// The point of the endpoint: a protected department is <em>counted</em> and nothing
    /// else.
    ///
    /// <para>
    /// Suppression exists to hide a group small enough that the group and the person are
    /// the same thing, so a payload that says "one department was withheld" and then names
    /// it has defeated the control in the act of announcing it. The name is searched for
    /// over the raw body rather than over the typed DTO, because the typed read would
    /// silently drop any field the DTO does not declare — a leak added to the projection
    /// tomorrow would be invisible to a deserialized assertion.
    /// </para>
    ///
    /// <para>
    /// The department's <em>size</em> is checked the same way and for the same reason, by
    /// walking every number in the document: four is the count that would identify it, and
    /// no legitimate figure in this fixture is four.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_protected_department_is_counted_but_never_named_and_never_sized()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        var response = await client.GetAsync("/dashboard/employee/last-outcome");
        var raw = await response.Content.ReadAsStringAsync();
        var body = (await response.Content.ReadFromJsonAsync<EmployeeLastOutcome>())!;

        // It is counted — the whole reason the rest of this test is not vacuous.
        Assert.Equal(1, body.ProtectedDepartmentCount);

        // And it is invisible: not its name, not its id.
        Assert.DoesNotContain(ProtectedName, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(_protectedDepartmentId.ToString(), raw, StringComparison.OrdinalIgnoreCase);

        // Not its size either. 4 is the number that would single it out; the body's real
        // figures are 14 / 3 / 1 / 5 / 3.
        var document = JsonDocument.Parse(raw);
        Assert.DoesNotContain(ProtectedDepartmentRespondents, Numbers(document.RootElement));

        // Its open action plan is still reported — it is a plan, and hiding what the
        // company did would be a worse answer than not naming who it was done for — but it
        // arrives without a name, indistinguishable from the company-wide plan beside it.
        Assert.Equal(2, body.PlansOpenedSince.Count(p => p.DepartmentName is null));
        Assert.Equal(EngineeringName, Assert.Single(body.PlansOpenedSince, p => p.DepartmentName is not null).DepartmentName);

        // The unprotected departments' names are absent too. Only a plan's department is
        // ever named here, so Operations — which answered, above the floor, but has no plan
        // — is not on the wire either. A payload listing the departments that answered
        // would let a reader subtract them from the org chart and be left with the
        // protected one.
        Assert.DoesNotContain(OperationsName, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(_operationsId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// An employee is not authorized for results — all four <c>/surveys/{id}/results</c>
    /// routes are admin-gated — so this route must not become the side door around them.
    ///
    /// <para>
    /// Asserted structurally, over the property names of the whole document, rather than by
    /// listing the fields the DTO happens to declare today: the failure this guards against
    /// is somebody serialising the <c>SurveyAggregate</c> straight through, and that lands
    /// as new keys rather than as changed values.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_panel_carries_no_score_of_any_kind()
    {
        var client = await ClientAsync(Roles.Employee, _companyADomain, _companyAId, _engineeringId);

        var raw = await (await client.GetAsync("/dashboard/employee/last-outcome")).Content.ReadAsStringAsync();
        var names = PropertyNames(JsonDocument.Parse(raw).RootElement).ToList();

        // It really did return a payload, so the absences below mean something.
        Assert.Contains("protectedDepartmentCount", names);

        foreach (var forbidden in new[]
        {
            "questions", "breakdowns", "segments", "buckets", "distribution",
            "average", "median", "score", "scores", "words", "respondentCount",
            "participationRate", "departments",
        })
        {
            Assert.DoesNotContain(forbidden, names, StringComparer.OrdinalIgnoreCase);
        }
    }

    // ------------------------------------------------------------------
    // Nothing to show
    // ------------------------------------------------------------------

    /// <summary>
    /// A tenant that has never closed a survey has no panel — null rather than a body full
    /// of zeroes, which would render as a sentence about a survey that never happened.
    /// </summary>
    [Fact]
    public async Task Nothing_comes_back_when_the_company_has_never_closed_a_survey()
    {
        var client = await ClientAsync(Roles.Employee, _companyCDomain, _companyCId);

        var response = await client.GetAsync("/dashboard/employee/last-outcome");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("null", (await response.Content.ReadAsStringAsync()).Trim());
        Assert.Null(await response.Content.ReadFromJsonAsync<EmployeeLastOutcome>());
    }

    /// <summary>
    /// A global super_admin belongs to no tenant (#191), and <c>CompanyId == null</c> is the
    /// widest scope in this schema rather than the narrowest. Absence of a company must
    /// therefore mean "no panel", never "every company's last survey".
    /// </summary>
    [Fact]
    public async Task A_user_with_no_company_gets_no_panel_rather_than_every_tenants()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain, clearCompany: true);

        var response = await client.GetAsync("/dashboard/employee/last-outcome");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("null", (await response.Content.ReadAsStringAsync()).Trim());
    }

    /// <summary>Every number anywhere in the document.</summary>
    private static IEnumerable<int> Numbers(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Number:
                if (element.TryGetInt32(out var value))
                {
                    yield return value;
                }

                break;
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    foreach (var found in Numbers(property.Value))
                    {
                        yield return found;
                    }
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var found in Numbers(item))
                    {
                        yield return found;
                    }
                }

                break;
            default:
                break;
        }
    }

    /// <summary>Every property name anywhere in the document.</summary>
    private static IEnumerable<string> PropertyNames(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    yield return property.Name;
                    foreach (var found in PropertyNames(property.Value))
                    {
                        yield return found;
                    }
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var found in PropertyNames(item))
                    {
                        yield return found;
                    }
                }

                break;
            default:
                break;
        }
    }
}
