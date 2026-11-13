using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Tracking;

/// <summary>
/// G25: the tracking pickers answer a node leader, scoped to exactly what
/// climate-tracking's <c>PlanAccessHandler</c> lets them act on — the one nodo their
/// <c>nodoId</c> claim names, and the people in it — and to nothing wider.
///
/// Every edge of that scope is a test here, and each reads the BODY: a leader answered 200
/// with the whole company would pass any status-only assertion.
///
/// - a sibling department (Sales) and its people are never listed to Engineering's leader;
/// - a CHILD department of Engineering is not either — the handler compares nodos for
///   equality, so a descendant is a node the service would refuse the leader a plan on;
/// - people with no department are not either;
/// - an administrator still sees everything;
/// - an employee and a supervisor are refused, as is a leader of another company.
/// </summary>
[Collection("Postgres")]
public class TrackingPickerLeaderScopeTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;

    private Guid _companyA;
    private Guid _companyB;
    private Guid _engineering;
    private Guid _platform;
    private Guid _sales;
    private Guid _closedSurvey;

    private Guid _engineeringMember;
    private Guid _platformMember;
    private Guid _salesMember;
    private Guid _unassignedMember;

    public TrackingPickerLeaderScopeTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"pls-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyA = await _harness.SeedCompanyAsync("Leader Picker Co A");
        _companyB = await _harness.SeedCompanyAsync("Leader Picker Co B");
        _engineering = await _harness.SeedDepartmentAsync(_companyA, "Engineering");
        _sales = await _harness.SeedDepartmentAsync(_companyA, "Sales");
        _platform = await _harness.SeedDepartmentAsync(_companyA, "Engineering Platform");
        await _harness.WithDbAsync(async db =>
        {
            var platform = await db.Departments.FirstAsync(d => d.Id == _platform);
            platform.ParentDepartmentId = _engineering;
            await db.SaveChangesAsync();
        });

        _engineeringMember = (await _harness.IdentifiedTokenAsync(Roles.Employee, _companyA, _engineering)).UserId;
        _platformMember = (await _harness.IdentifiedTokenAsync(Roles.Employee, _companyA, _platform)).UserId;
        _salesMember = (await _harness.IdentifiedTokenAsync(Roles.Employee, _companyA, _sales)).UserId;
        _unassignedMember = (await _harness.IdentifiedTokenAsync(Roles.Employee, _companyA)).UserId;

        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);
        _closedSurvey = await SeedClosedSurveyAsync(admin, _companyA, new Dictionary<Guid, int>
        {
            [_engineering] = 4,
            [_sales] = 4,
            [Guid.Empty] = 1,
        });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<Guid> SeedClosedSurveyAsync(HttpClient admin, Guid companyId, IReadOnlyDictionary<Guid, int> perDepartment)
    {
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            companyId,
            questions:
            [
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Communication is clear"), "likert", Order: 0, Category: "comunicacion"),
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Good work is recognised"), "likert", Order: 1, Category: "reconocimiento"),
            ]));

        var questionIds = survey.Questions.Select(q => q.Id).ToList();
        await _harness.WithDbAsync(async db =>
        {
            foreach (var (departmentId, count) in perDepartment)
            {
                for (var i = 0; i < count; i++)
                {
                    var responseId = Guid.NewGuid();
                    db.Responses.Add(new Response
                    {
                        Id = responseId,
                        SurveyId = survey.Id,
                        CompanyId = companyId,
                        DepartmentId = departmentId == Guid.Empty ? null : departmentId,
                        SessionId = Guid.NewGuid().ToString("N"),
                        Language = "en",
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
                        db.QuestionResponses.Add(new QuestionResponse
                        {
                            ResponseId = responseId,
                            QuestionId = questionId,
                            ResponseValue = JsonSerializer.Serialize("4"),
                            ResponseText = null,
                        });
                    }
                }
            }

            await db.SaveChangesAsync();
        });

        await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active);
        await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Closed);
        return survey.Id;
    }

    // ------------------------------------------------------------------
    // Nodos
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_leader_lists_exactly_their_own_nodo_and_neither_a_sibling_nor_a_child()
    {
        var leader = await _harness.ClientAsync(Roles.Leader, _companyA, _engineering);

        var response = await leader.GetAsync($"/tracking/picker/nodos?companyId={_companyA}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<NodoPickerResponse>();
        var only = Assert.Single(body!.Nodos);
        Assert.Equal(_engineering.ToString(), only.Id);
        Assert.Equal("Engineering", only.Name);
    }

    [Fact]
    public async Task An_administrator_still_lists_every_nodo_of_the_company()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);

        var body = await (await admin.GetAsync($"/tracking/picker/nodos?companyId={_companyA}"))
            .Content.ReadFromJsonAsync<NodoPickerResponse>();

        Assert.Equal(
            new[] { _engineering, _platform, _sales }.Select(id => id.ToString()).Order(),
            body!.Nodos.Select(n => n.Id).Order());
    }

    // ------------------------------------------------------------------
    // Personas
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_leader_lists_only_the_people_of_their_own_nodo()
    {
        var (leader, leaderId) = await _harness.IdentifiedClientAsync(Roles.Leader, _companyA, _engineering);

        var response = await leader.GetAsync($"/tracking/picker/personas?companyId={_companyA}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var ids = (await response.Content.ReadFromJsonAsync<PersonaPickerResponse>())!.Personas.Select(p => p.Id).ToHashSet();
        Assert.Equal(new HashSet<string> { _engineeringMember.ToString(), leaderId.ToString() }, ids);
        Assert.DoesNotContain(_salesMember.ToString(), ids);
        Assert.DoesNotContain(_platformMember.ToString(), ids);
        Assert.DoesNotContain(_unassignedMember.ToString(), ids);
    }

    [Fact]
    public async Task A_leader_of_the_sibling_nodo_sees_that_nodos_people_and_not_engineerings()
    {
        var leader = await _harness.ClientAsync(Roles.Leader, _companyA, _sales);

        var ids = (await (await leader.GetAsync($"/tracking/picker/personas?companyId={_companyA}"))
            .Content.ReadFromJsonAsync<PersonaPickerResponse>())!.Personas.Select(p => p.Id).ToList();

        Assert.Contains(_salesMember.ToString(), ids);
        Assert.DoesNotContain(_engineeringMember.ToString(), ids);
    }

    [Fact]
    public async Task An_administrator_still_lists_every_active_person_of_the_company()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);

        var ids = (await (await admin.GetAsync($"/tracking/picker/personas?companyId={_companyA}"))
            .Content.ReadFromJsonAsync<PersonaPickerResponse>())!.Personas.Select(p => p.Id).ToList();

        Assert.Contains(_engineeringMember.ToString(), ids);
        Assert.Contains(_platformMember.ToString(), ids);
        Assert.Contains(_salesMember.ToString(), ids);
        Assert.Contains(_unassignedMember.ToString(), ids);
    }

    [Fact]
    public async Task A_leader_with_no_department_leads_nothing_and_is_listed_nobody()
    {
        var leader = await _harness.ClientAsync(Roles.Leader, _companyA);

        var nodos = await (await leader.GetAsync($"/tracking/picker/nodos?companyId={_companyA}"))
            .Content.ReadFromJsonAsync<NodoPickerResponse>();
        var personas = await (await leader.GetAsync($"/tracking/picker/personas?companyId={_companyA}"))
            .Content.ReadFromJsonAsync<PersonaPickerResponse>();

        Assert.Empty(nodos!.Nodos);
        Assert.Empty(personas!.Personas);
    }

    // ------------------------------------------------------------------
    // Refusals
    // ------------------------------------------------------------------

    public static TheoryData<string> RefusedRoles => new() { Roles.Employee, Roles.Supervisor };

    [Theory]
    [MemberData(nameof(RefusedRoles))]
    public async Task An_employee_or_supervisor_is_refused_every_picker(string role)
    {
        var caller = await _harness.ClientAsync(role, _companyA, _engineering);

        Assert.Equal(HttpStatusCode.Forbidden, (await caller.GetAsync($"/tracking/picker/nodos?companyId={_companyA}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await caller.GetAsync($"/tracking/picker/personas?companyId={_companyA}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await caller.GetAsync($"/tracking/picker/hallazgos?companyId={_companyA}&nodoId={_engineering}")).StatusCode);
    }

    [Fact]
    public async Task A_leader_is_refused_another_companys_pickers()
    {
        var leader = await _harness.ClientAsync(Roles.Leader, _companyA, _engineering);

        Assert.Equal(HttpStatusCode.Forbidden, (await leader.GetAsync($"/tracking/picker/nodos?companyId={_companyB}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await leader.GetAsync($"/tracking/picker/personas?companyId={_companyB}")).StatusCode);
    }

    // ------------------------------------------------------------------
    // Hallazgos
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_leader_lists_their_own_nodos_findings_by_survey_and_dimension_and_no_score()
    {
        var leader = await _harness.ClientAsync(Roles.Leader, _companyA, _engineering);

        var response = await leader.GetAsync($"/tracking/picker/hallazgos?companyId={_companyA}&nodoId={_engineering}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("resultado", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pct", raw, StringComparison.OrdinalIgnoreCase);

        var body = JsonSerializer.Deserialize<HallazgoPickerResponse>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(
            new[] { "comunicacion", "reconocimiento" },
            body!.Hallazgos.Select(h => h.Dimension).Order());
        Assert.All(body.Hallazgos, h =>
        {
            Assert.Equal(_closedSurvey.ToString(), h.SurveyId);
            Assert.Equal(TrackingIdentifiers.ExternalHallazgoId(_closedSurvey, _engineering, h.Dimension), h.Id);
            Assert.False(string.IsNullOrWhiteSpace(h.SurveyTitle));
        });
    }

    [Fact]
    public async Task A_leader_is_refused_the_findings_of_a_sibling_nodo()
    {
        var leader = await _harness.ClientAsync(Roles.Leader, _companyA, _engineering);

        var response = await leader.GetAsync($"/tracking/picker/hallazgos?companyId={_companyA}&nodoId={_sales}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_administrator_lists_any_nodos_findings_and_only_that_nodos()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);

        var body = await (await admin.GetAsync($"/tracking/picker/hallazgos?companyId={_companyA}&nodoId={_sales}"))
            .Content.ReadFromJsonAsync<HallazgoPickerResponse>();

        Assert.Equal(2, body!.Hallazgos.Count);
        Assert.All(body.Hallazgos, h =>
            Assert.Equal(TrackingIdentifiers.ExternalHallazgoId(_closedSurvey, _sales, h.Dimension), h.Id));
    }

    [Fact]
    public async Task The_findings_picker_requires_a_nodo()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);

        var response = await admin.GetAsync($"/tracking/picker/hallazgos?companyId={_companyA}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
