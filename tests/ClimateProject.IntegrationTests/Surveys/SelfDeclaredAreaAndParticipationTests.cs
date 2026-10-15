using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Dashboard;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// The two rulings of 2026-10-12, end to end against a real Postgres.
/// <list type="number">
/// <item>The department climate map is fed by the área a respondent with NO account declares,
/// stored as a demographic answer -- never as <c>responses.department_id</c> -- and floored at 5
/// at read time.</item>
/// <item>"Collect name and email because we need to know who has answered and who has not, but
/// DON'T link them to their answers."</item>
/// </list>
/// </summary>
[Collection("Postgres")]
public class SelfDeclaredAreaAndParticipationTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _operaciones;
    private Guid _ventas;
    private Guid _finanzas;
    private Guid _retired;

    /// <summary>Per test: user emails are unique across the whole shared database.</summary>
    private readonly string _mail = $"{Guid.NewGuid():N}.planta.test";

    public SelfDeclaredAreaAndParticipationTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"area-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Planta Co", language: "es");
        _operaciones = await _harness.SeedDepartmentAsync(_companyId, "Operaciones");
        _ventas = await _harness.SeedDepartmentAsync(_companyId, "Ventas");
        _finanzas = await _harness.SeedDepartmentAsync(_companyId, "Finanzas");
        _retired = await _harness.SeedDepartmentAsync(_companyId, "Retirada");
        await _harness.WithDbAsync(async db =>
        {
            var retired = await db.Departments.FirstAsync(d => d.Id == _retired);
            retired.IsActive = false;
            return await db.SaveChangesAsync();
        });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Part 1: the área feeds the department map
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_public_form_asks_the_area_first_offering_only_the_companys_active_departments()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);

        var view = await RespondViewAsync(_factory.CreateClient(), survey.Id);

        var area = view.Demographics[0];
        Assert.Equal(SelfDeclaredDepartment.FieldKey, area.Field);
        Assert.True(area.Required);
        Assert.Equal("¿En qué área trabaja?", area.Label);
        Assert.Equal(
            new[] { _finanzas, _operaciones, _ventas }.Select(id => id.ToString()),
            area.Options.Select(o => o.Value));
        Assert.Equal(["Finanzas", "Operaciones", "Ventas"], area.Options.Select(o => o.Label));
    }

    /// <summary>
    /// (a) and (b) in one cohort, sized so the complement rule cannot hide the answer: 5 in
    /// Operaciones and one short of the floor in each of Ventas and Finanzas. Their combined
    /// remainder clears the floor, so Operaciones is published; Ventas and Finanzas are each
    /// under it and carry no number at all.
    /// Mutate <c>SelfDeclaredDepartment.Effective</c> to return only the stored department and
    /// the Operaciones row disappears.
    /// </summary>
    [Fact]
    public async Task A_published_area_fills_its_departments_row_and_areas_under_the_floor_do_not()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);
        await AnswerAsAreaAsync(survey, _operaciones, 5);
        await AnswerAsAreaAsync(survey, _ventas, SurveyResultsPrivacy.MinimumRespondents - 1);
        await AnswerAsAreaAsync(survey, _finanzas, SurveyResultsPrivacy.MinimumRespondents - 1);

        var admin = await AdminAsync();
        var statistics = (await admin.GetFromJsonAsync<SurveyStatisticsResponse>($"/surveys/{survey.Id}/statistics"))!;
        var departments = Assert.Single(statistics.Breakdowns, b => b.Dimension == "department");

        var operaciones = Assert.Single(departments.Segments, s => s.Key == _operaciones.ToString());
        Assert.False(operaciones.IsSuppressed);
        Assert.Equal(5, operaciones.RespondentCount);
        Assert.NotEmpty(operaciones.Questions);

        // Since #543 a withheld group is counted, never named: Ventas and Finanzas are both
        // under the floor, absent from the rows and present only in the counter.
        Assert.Single(departments.Segments);
        Assert.DoesNotContain(departments.Segments, s => s.Key == _ventas.ToString() || s.Key == _finanzas.ToString());
        Assert.Equal(2, departments.SuppressedSegmentCount);
        Assert.Equal(0, departments.UnsegmentedRespondentCount);

        // The reserved key is lifted into the department, never ALSO published as a
        // demographic dimension keyed by raw ids.
        Assert.DoesNotContain(statistics.Breakdowns, b => b.Dimension != "department");

        // The live panel counts the same population under the same floor.
        var live = (await admin.GetFromJsonAsync<SurveyRealTimeStatsResponse>($"/surveys/{survey.Id}/real-time-stats"))!;
        var liveRow = Assert.Single(live.ByDepartment);
        Assert.Equal(_operaciones, liveRow.DepartmentId);
        Assert.Equal(5, liveRow.CompletedCount);
        Assert.Equal(2, live.SuppressedDepartmentCount);
        Assert.Equal(0, live.UnsegmentedRespondentCount);

        // And climate over time, once the survey has closed.
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();
        var trends = (await admin.GetFromJsonAsync<ClimateTrendsResponse>("/surveys/climate-trends?groupBy=department"))!;
        var column = trends.Surveys.ToList().FindIndex(s => s.SurveyId == survey.Id);
        Assert.True(column >= 0);

        var operacionesPoint = Assert.Single(trends.Groups, g => g.Key == _operaciones.ToString()).Points[column];
        Assert.False(operacionesPoint.IsSuppressed);
        Assert.Equal(5, operacionesPoint.RespondentCount);
        Assert.Contains(operacionesPoint.Scores, score => score is not null);

        var ventasPoint = Assert.Single(trends.Groups, g => g.Key == _ventas.ToString()).Points[column];
        Assert.True(ventasPoint.IsSuppressed);
        Assert.Equal(0, ventasPoint.RespondentCount);
        Assert.All(ventasPoint.Scores, score => Assert.Null(score));
    }

    /// <summary>(b) on its own: four respondents in one área, alone, publish nothing about it.</summary>
    [Fact]
    public async Task Four_self_declared_respondents_never_produce_a_number_for_their_area()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);
        await AnswerAsAreaAsync(survey, _ventas, 4);
        await AnswerAsAreaAsync(survey, _operaciones, 5);
        await AnswerAsAreaAsync(survey, _finanzas, 1);

        var admin = await AdminAsync();
        var json = await admin.GetStringAsync($"/surveys/{survey.Id}/statistics");
        var statistics = JsonSerializer.Deserialize<SurveyStatisticsResponse>(json, JsonOptions)!;
        var departments = Assert.Single(statistics.Breakdowns, b => b.Dimension == "department");

        // Withheld, counted, and never named (#543): no row, no key, no label anywhere.
        Assert.DoesNotContain(departments.Segments, s => s.Key == _ventas.ToString());
        Assert.Equal(2, departments.SuppressedSegmentCount);
        Assert.DoesNotContain(_ventas.ToString(), json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Ventas", json, StringComparison.Ordinal);
    }

    /// <summary>(d) Ruling 4 holds: the self-declared área is an ANSWER, the FK column stays null.</summary>
    [Fact]
    public async Task A_self_declared_area_is_stored_as_an_answer_and_department_id_stays_null()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);

        var result = await SubmitAsync(survey, Area(_operaciones));
        Assert.Equal(HttpStatusCode.Created, result.StatusCode);
        var responseId = (await result.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId;

        var row = await _harness.WithDbAsync(db => db.Responses.AsNoTracking().FirstAsync(r => r.Id == responseId));
        Assert.Null(row.DepartmentId);
        Assert.Null(row.UserId);

        var stored = Assert.Single(await _harness.WithDbAsync(db => db.ResponseDemographics
            .AsNoTracking().Where(rd => rd.ResponseId == responseId).ToListAsync()));
        Assert.Equal(SelfDeclaredDepartment.FieldKey, stored.Field);
        Assert.Equal($"\"{_operaciones}\"", stored.Value);
    }

    /// <summary>
    /// (c) Another tenant's department, a retired department, and garbage are each refused with
    /// 400 -- and write nothing: no response, no answer, no demographic, no participation.
    /// </summary>
    [Theory]
    [InlineData("other-tenant")]
    [InlineData("inactive")]
    [InlineData("not-a-guid")]
    public async Task An_area_outside_the_companys_active_departments_is_refused_and_writes_nothing(string which)
    {
        var otherCompany = await _harness.SeedCompanyAsync("Otra Co");
        var otherDepartment = await _harness.SeedDepartmentAsync(otherCompany, "Operaciones");
        var survey = await QrSurveyAsync(collectIdentity: true);
        var value = which switch
        {
            "other-tenant" => otherDepartment.ToString(),
            "inactive" => _retired.ToString(),
            _ => "operaciones",
        };

        var http = await SubmitAsync(
            survey,
            new Dictionary<string, string?> { [SelfDeclaredDepartment.FieldKey] = value },
            new SurveyParticipantInput("Ana Pérez", $"ana@{_mail}"));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Equal(0, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
        Assert.Equal(0, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task An_area_is_required_to_complete()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);

        var http = await SubmitAsync(survey, new Dictionary<string, string?>());

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
    }

    [Theory]
    [InlineData("department")]
    [InlineData(" Department ")]
    public async Task An_admin_cannot_create_a_field_with_the_reserved_key(string key)
    {
        var admin = await AdminAsync();

        var http = await admin.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyId, key, LocalizedInput.FromBare("Área"), "select",
            [new DemographicFieldOptionInput("operaciones", LocalizedInput.FromBare("Operaciones"))], Required: false, Order: 0));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.False(await _harness.WithDbAsync(db => db.DemographicFields.AnyAsync(f => f.CompanyId == _companyId)));
    }

    /// <summary>
    /// The company dashboard's per-department count includes the área a visitor declared.
    /// It read 0 for every área of EAGLE's link-only survey (2026-10-12), because it counted
    /// <c>responses.department_id</c> only, which a declared área never sets. The payload is
    /// unfloored by contract; the dashboard export floors it (DashboardExport).
    /// </summary>
    [Fact]
    public async Task The_company_dashboard_counts_the_area_a_visitor_declared()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);
        await AnswerAsAreaAsync(survey, _ventas, 6);
        await AnswerAsAreaAsync(survey, _finanzas, 2);
        // A partial save is not a completed response, declared área or not.
        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(survey, Area(_ventas), isComplete: false)).StatusCode);

        var admin = await AdminAsync();
        var dashboard = (await admin.GetFromJsonAsync<CompanyAdminDashboard>("/dashboard/company-admin"))!;

        var counts = dashboard.Departments.ToDictionary(d => d.Id, d => d.CompletedResponseCount);
        Assert.Equal(6, counts[_ventas]);
        Assert.Equal(2, counts[_finanzas]);
        Assert.Equal(0, counts[_operaciones]);
    }

    [Fact]
    public async Task The_export_names_the_area_and_each_field_and_option_with_the_companys_labels()
    {
        var admin = await AdminAsync();
        (await admin.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyId, "turno", LocalizedInput.FromBare("Turno"), "select",
            [new DemographicFieldOptionInput("manana", LocalizedInput.FromBare("Mañana"))], Required: false, Order: 1)))
            .EnsureSuccessStatusCode();
        var survey = await QrSurveyAsync(collectIdentity: false);
        for (var i = 0; i < 6; i++)
        {
            var http = await SubmitAsync(survey, new Dictionary<string, string?>(Area(_ventas)) { ["turno"] = "manana" });
            Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        }

        var csv = await admin.GetStringAsync($"/surveys/{survey.Id}/export/csv?lang=es");

        Assert.Contains("\"breakdown\",\"\",\"department\",\"es\",\"label\",\"Área\"", csv);
        Assert.Contains("\"breakdown\",\"\",\"turno\",\"es\",\"label\",\"Turno\"", csv);
        Assert.Contains("\"segment\",\"\",\"turno:manana\",\"es\",\"label\",\"Mañana\"", csv);
    }

    // ------------------------------------------------------------------
    // Part 2: who answered, never linked to what they said
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_survey_created_without_a_word_about_it_collects_no_participant_identity()
    {
        var admin = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyId) with
        {
            Settings = new SurveySettingsInput(Anonymous: true),
        });

        // Ruled 2026-10-13: a name and an email are never collected directly, in any of the
        // three ways a survey is answered. The create path used to turn this on.
        Assert.False(survey.Settings.CollectParticipantIdentity);
    }

    /// <summary>
    /// The one that matters for the surveys already in the database. Every survey created
    /// between the 10-12 and the 10-13 rulings carries the column TRUE, so a change only to
    /// the create path would have left them all still asking. `collectIdentity: true` below
    /// writes that column, and the view still refuses to ask.
    /// </summary>
    [Fact]
    public async Task The_respond_view_never_asks_who_is_answering()
    {
        var asking = await QrSurveyAsync(collectIdentity: true);
        var silent = await QrSurveyAsync(collectIdentity: false);
        var employee = await _harness.ClientAsync(Roles.Employee, _companyId, _operaciones);

        var stored = await _harness.WithDbAsync(db => db.Surveys.AsNoTracking().FirstAsync(s => s.Id == asking.Id));
        Assert.True(stored.Settings.CollectParticipantIdentity, "the column is on, which is the point of this test");

        Assert.False((await RespondViewAsync(_factory.CreateClient(), asking.Id)).AsksParticipantIdentity);
        Assert.False((await RespondViewAsync(_factory.CreateClient(), silent.Id)).AsksParticipantIdentity);
        Assert.False((await RespondViewAsync(employee, asking.Id)).AsksParticipantIdentity);
    }

    /// <summary>
    /// And the write path: a client that asks anyway -- a stale bundle, or a script -- is
    /// REFUSED rather than quietly obeyed, so no row can reach `survey_participations`.
    /// </summary>
    [Fact]
    public async Task A_submit_that_carries_a_name_is_refused()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        var http = await SubmitAsync(
            survey, Area(_operaciones), new SurveyParticipantInput("Persona", $"persona@{_mail}"));
        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);

        var participations = await _harness.WithDbAsync(db => db.SurveyParticipations.AsNoTracking()
            .Where(x => x.SurveyId == survey.Id).ToListAsync());
        Assert.Empty(participations);

        // The vacuity control: the same submit WITHOUT a name is accepted, so the 400 above is
        // about the name and not about the survey, the área or the answer.
        var clean = await SubmitAsync(survey, Area(_operaciones));
        Assert.Equal(HttpStatusCode.Created, clean.StatusCode);
    }

    /// <summary>
    /// The row records THAT, never WHAT. Asserted three ways: the table has exactly the six
    /// columns the ruling allows (no response id, no session, no demographics, no IP, no
    /// timestamp); the stored values are the identity and a day; and the participation row was
    /// written by a DIFFERENT transaction from the response's, so Postgres's own transaction id
    /// (<c>xmin</c>) is not a join key. Move the write inside the response transaction and the
    /// last assertion fails.
    /// </summary>
    [Fact]
    public async Task No_link_path_fills_the_participation_table_and_it_still_keeps_no_join_key()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        // The only submit the server now accepts: no identity at all. It used to carry a name
        // and an email, and the row that produced is what the rest of this test measured.
        var http = await SubmitAsync(survey, Area(_operaciones));
        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        var responseId = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId;

        // The table's shape is still a guarantee worth pinning: no response id, no session, no
        // demographics, no IP, no timestamp -- so if the ruling moves again and the write comes
        // back, it comes back to a table that cannot be joined to the answers.
        var columns = await ScalarListAsync(
            "SELECT column_name AS \"Value\" FROM information_schema.columns WHERE table_name = 'survey_participations' ORDER BY column_name");
        Assert.Equal(["company_id", "email", "id", "name", "participated_on", "survey_id"], columns);

        // And nothing reaches it, from a completing post or any other path (ruled 2026-10-13:
        // nobody is asked who they are, so there is nothing to record). The xmin ordering this
        // test used to assert is gone with the write it ordered.
        Assert.Empty(await _harness.WithDbAsync(db => db.SurveyParticipations
            .AsNoTracking().Where(p => p.SurveyId == survey.Id).ToListAsync()));

        // The response itself carries no trace of who, as before.
        var row = await _harness.WithDbAsync(db => db.Responses.AsNoTracking().FirstAsync(r => r.Id == responseId));
        Assert.Null(row.UserId);
        Assert.Null(row.IpAddress);
        Assert.Null(row.UserAgent);
    }

    /// <summary>
    /// A name with no email used to be the "operario sin correo" case, and enough to record a
    /// participation. It is now refused like any other identity -- kept as its own test because
    /// <c>A_submit_that_carries_a_name_is_refused</c> sends both halves, and a name-only body is
    /// the shape a stale bundle is most likely to send.
    /// </summary>
    [Fact]
    public async Task A_submit_that_carries_only_a_name_is_refused_too()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        var http = await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput("José Mora"));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Empty(await _harness.WithDbAsync(db => db.SurveyParticipations
            .AsNoTracking().Where(p => p.SurveyId == survey.Id).ToListAsync()));
    }

    /// <summary>
    /// Every one of these is refused because it carries an identity AT ALL, not because the
    /// identity is malformed -- which is why the `(null, null)` case that used to head this list
    /// is gone: a post with no identity is now the accepted shape, and
    /// <c>No_link_path_fills_the_participation_table_and_it_still_keeps_no_join_key</c> pins it.
    /// Refusing writes nothing, not even the response.
    /// </summary>
    [Theory]
    [InlineData("   ", "ana@planta.test")]
    [InlineData("Ana", "not-an-email")]
    [InlineData("Ana", "ana@@planta.test")]
    public async Task A_completing_post_that_carries_any_identity_is_refused_and_writes_nothing(string? name, string? email)
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        var http = await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput(name, email));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Equal(0, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
        Assert.Equal(0, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task A_partial_save_records_no_participation()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        // Without an identity, which is the only shape accepted now. The guarantee is unchanged:
        // a respondent who abandons halfway leaves nothing behind that says they were here.
        var http = await SubmitAsync(survey, Area(_operaciones), isComplete: false);

        Assert.True(http.IsSuccessStatusCode, $"a partial save must be accepted, got {http.StatusCode}");
        Assert.Equal(0, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
    }

    /// <summary>
    /// The de-duplication this used to assert (one participation for two answers from one email)
    /// is unreachable now that no email is collected. What survives is the half that matters to
    /// a respondent: answering twice is never blocked, and the second answer is a second
    /// response rather than a refusal.
    /// </summary>
    [Fact]
    public async Task Answering_twice_is_never_blocked_and_records_no_participation()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(survey, Area(_operaciones))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(survey, Area(_ventas))).StatusCode);

        Assert.Equal(2, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id && r.IsComplete)));
        Assert.Equal(0, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task A_survey_that_does_not_ask_refuses_an_identity()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);

        var http = await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput("Ana", $"ana@{_mail}"));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Equal(0, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
    }

    // ------------------------------------------------------------------
    // Part 2: the admin view
    // ------------------------------------------------------------------

    [Fact]
    public void Names_are_listed_as_a_person_reads_them_whatever_the_database_collation()
    {
        string[] names = ["Zoe", "Persona 10", "álvaro", "Persona 2", "Ana", "Óscar"];

        var ordered = names.OrderBy(n => n, ClimateProject.Api.Endpoints.SurveyParticipationEndpoints.NameOrder).ToList();

        Assert.Equal(["álvaro", "Ana", "Óscar", "Persona 2", "Persona 10", "Zoe"], ordered);
    }

    [Fact]
    public async Task An_admin_sees_nobody_answered_everybody_pending_and_nothing_else()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);
        await SeedUserAsync("Ana Pérez", $"ana@{_mail}", isActive: true);
        await SeedUserAsync("Bruno Solís", $"bruno@{_mail}", isActive: true);
        await SeedUserAsync("Carla Ruiz", $"carla@{_mail}", isActive: false);
        // No identity on either submit: one carrying a name is refused outright now.
        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(survey, Area(_operaciones))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(survey, Area(_ventas))).StatusCode);

        var admin = await AdminAsync();
        var http = await admin.GetAsync($"/surveys/{survey.Id}/participation");
        Assert.Equal(HttpStatusCode.OK, http.StatusCode);
        var json = await http.Content.ReadAsStringAsync();
        var view = JsonSerializer.Deserialize<SurveyParticipationView>(json, JsonOptions)!;

        // SETTLED 2026-10-13: the view reports the PREDICATE, not the stored column. This
        // survey was authored with `collectIdentity: true` and the flag still reads false,
        // because no path can act on it any more -- a screen saying a survey collects who
        // answered, beside an answered list the ruling guarantees is empty, was a false claim
        // about the product rather than a record of intent. The column, the table, the DTO
        // flag and the authoring switch all survive; the revert is one line, in
        // `SurveyResponsePrivacy.CollectsParticipantIdentity`, and it moves this view and the
        // respond flow together instead of letting them disagree again.
        Assert.False(view.CollectsParticipantIdentity);

        // Two people answered and the view knows of neither, because there is no identity to
        // know. This is the ruling, not a defect: `survey_participations` recorded THAT an
        // anonymous respondent answered, and nobody is asked who they are any more.
        Assert.Equal(0, view.AnsweredCount);
        Assert.Empty(view.Answered);

        // So every active user is still pending, and the deactivated one is in neither list.
        Assert.Contains(view.Pending, p => p.Email == $"ana@{_mail}");
        Assert.Contains(view.Pending, p => p.Email == $"bruno@{_mail}");
        Assert.DoesNotContain(view.Pending, p => p.Email == $"carla@{_mail}");
        Assert.Equal(view.Pending.Count, view.PendingCount);

        // Two people DID answer this survey, and the roster still names nobody. A QR response
        // carries no user id, so every row falls to `not_started` on the absence of data
        // rather than on a flag -- which is the property that makes it safe to put a named
        // roster on a screen about an anonymous survey at all.
        Assert.NotEmpty(view.Roster);
        Assert.All(view.Roster, r => Assert.Equal(SurveyParticipantStatuses.NotStarted, r.Status));
        Assert.Equal(0, view.StartedCount);

        // And the view SAYS so, rather than leaving the screen to present a roster of false
        // negatives as participation. "Nobody answered" and "nobody is counted individually"
        // are different claims, and on 800 people only one of them is true here.
        Assert.False(view.TracksIndividuals);

        // Nothing about answers, areas or timing travels: the shape has no such member.
        //
        // The roster added 2026-10-14 is pinned member by member, one level down, for exactly
        // the reason the top level is: it carries participation STATE, the username an
        // administrator reads back on the phone, and the demographics that same administrator
        // uploaded -- and a field arriving in it without a decision is how an answer would
        // eventually ride along. Extend these lists deliberately or not at all.
        using var document = JsonDocument.Parse(json);
        Assert.Equal(
            ["answered", "answeredCount", "collectsParticipantIdentity", "notStartedCount", "pending", "pendingCount", "roster", "startedCount", "surveyId", "tracksIndividuals"],
            document.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal(
            ["demographics", "email", "lastActivityOn", "name", "role", "status", "userId", "username"],
            document.RootElement.GetProperty("roster").EnumerateArray().First().EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.DoesNotContain(_operaciones.ToString(), json, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    public async Task Someone_who_does_not_administer_the_survey_is_refused(string role)
    {
        var survey = await QrSurveyAsync(collectIdentity: true);
        var caller = await _harness.ClientAsync(role, _companyId, _operaciones);

        var http = await caller.GetAsync($"/surveys/{survey.Id}/participation");

        Assert.Equal(HttpStatusCode.Forbidden, http.StatusCode);
    }

    [Fact]
    public async Task Another_tenants_admin_is_refused()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);
        var otherCompany = await _harness.SeedCompanyAsync("Otra Co");
        var otherAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, otherCompany);

        var http = await otherAdmin.GetAsync($"/surveys/{survey.Id}/participation");

        Assert.Equal(HttpStatusCode.Forbidden, http.StatusCode);
    }

    [Fact]
    public async Task A_super_admin_may_read_it_and_an_anonymous_caller_may_not()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, null);

        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/surveys/{survey.Id}/participation")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync($"/surveys/{survey.Id}/participation")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await superAdmin.GetAsync($"/surveys/{Guid.NewGuid()}/participation")).StatusCode);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Part 3: an IDENTIFIED survey answered by link (possible since #544)
    // ------------------------------------------------------------------

    /// <summary>
    /// End to end, the case neither ruling could reach before every survey had a link: a
    /// visitor with NO account answers an IDENTIFIED survey through its link, declaring an
    /// área and a name/email. They are served anonymously -- no user id, no IP, no user agent,
    /// no department FK -- their área feeds the department breakdown under the segment floor
    /// (an área at the floor publishes its number, one under it publishes none), and who
    /// answered lands in a
    /// participation row that has no column that could point at the response.
    /// </summary>
    [Fact]
    public async Task A_visitor_answers_an_identified_survey_by_link_anonymously_and_their_area_and_attendance_are_counted_apart()
    {
        var survey = await QrSurveyAsync(collectIdentity: true, anonymous: false);
        var stored = await _harness.WithDbAsync(db => db.Surveys.AsNoTracking().FirstAsync(s => s.Id == survey.Id));
        Assert.False(stored.Settings.Anonymous);

        // The respond view tells the visitor the truth about THEIR answer, and asks the área
        // and nothing else: no name, no email (ruled 2026-10-13).
        var view = await RespondViewAsync(_factory.CreateClient(), survey.Id);
        Assert.True(view.Anonymous);
        Assert.False(view.AsksParticipantIdentity);
        Assert.Contains(view.Demographics, d => d.Field == SelfDeclaredDepartment.FieldKey);

        var responseIds = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            var http = await SubmitAsync(survey, Area(_operaciones));
            Assert.Equal(HttpStatusCode.Created, http.StatusCode);
            responseIds.Add((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);
        }
        for (var i = 0; i < 4; i++)
        {
            var http = await SubmitAsync(survey, Area(_ventas));
            Assert.Equal(HttpStatusCode.Created, http.StatusCode);
            responseIds.Add((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);
        }
        // One more, elsewhere: withheld groups must total >= 5 or #543's complement rule
        // withholds Operaciones too (5 shown + 4 withheld would let a reader subtract to 4).
        var finanzas = await SubmitAsync(survey, Area(_finanzas));
        Assert.Equal(HttpStatusCode.Created, finanzas.StatusCode);
        responseIds.Add((await finanzas.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);

        // Stored anonymously, on an identified survey.
        var rows = await _harness.WithDbAsync(db => db.Responses.AsNoTracking()
            .Where(r => r.SurveyId == survey.Id).ToListAsync());
        Assert.Equal(10, rows.Count);
        Assert.All(rows, row =>
        {
            Assert.Null(row.UserId);
            Assert.Null(row.IpAddress);
            Assert.Null(row.UserAgent);
            Assert.Null(row.DepartmentId);
        });

        // Five in Operaciones publish it; four in Ventas publish no number.
        var admin = await AdminAsync();
        var json = await admin.GetStringAsync($"/surveys/{survey.Id}/statistics");
        var statistics = JsonSerializer.Deserialize<SurveyStatisticsResponse>(json, JsonOptions)!;
        var departments = Assert.Single(statistics.Breakdowns, b => b.Dimension == "department");

        var operaciones = Assert.Single(departments.Segments, s => s.Key == _operaciones.ToString());
        Assert.False(operaciones.IsSuppressed);
        Assert.Equal(5, operaciones.RespondentCount);
        Assert.NotEmpty(operaciones.Questions);

        // Ventas (and Finanzas) are withheld: counted, never named, no number of their own (#543).
        Assert.Single(departments.Segments);
        Assert.Equal(2, departments.SuppressedSegmentCount);
        Assert.DoesNotContain(_ventas.ToString(), json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Ventas", json, StringComparison.Ordinal);

        // Who answered: NOBODY was asked, so the table the 10-12 ruling built stays empty.
        // Its shape is still asserted -- the table and the entity survive, so that restoring
        // the step is one line rather than a migration -- but ten answers write nothing to it.
        var columns = await ScalarListAsync(
            "SELECT column_name AS \"Value\" FROM information_schema.columns WHERE table_name = 'survey_participations' ORDER BY column_name");
        Assert.Equal(["company_id", "email", "id", "name", "participated_on", "survey_id"], columns);

        var participations = await _harness.WithDbAsync(db => db.SurveyParticipations.AsNoTracking()
            .Where(p => p.SurveyId == survey.Id).ToListAsync());
        Assert.Empty(participations);
        Assert.Equal(10, responseIds.Count);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    /// <summary>An open survey answered through the QR: área asked, identity per the test.</summary>
    private async Task<SurveyDetail> QrSurveyAsync(bool collectIdentity, bool anonymous = true)
    {
        var admin = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Clima Q4"),
            CompanyId: _companyId,
            Type: "periodic",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Confío en mi jefatura"),
                    "likert",
                    ScaleMin: 1,
                    ScaleMax: 5,
                    Required: true,
                    CommentRequired: false,
                    Order: 0,
                    Category: "liderazgo"),
            ],
            Settings: new SurveySettingsInput(
                Anonymous: anonymous,
                SelfDeclaredDemographics: true,
                CollectParticipantIdentity: collectIdentity)));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        await SurveyTestHarness.OpenPublicLinkAsync(admin, survey.Id);
        return survey;
    }

    private static Dictionary<string, string?> Area(Guid departmentId)
        => new() { [SelfDeclaredDepartment.FieldKey] = departmentId.ToString() };

    /// <summary>A stranger with no account, completing the survey. A fresh client every time.</summary>
    private Task<HttpResponseMessage> SubmitAsync(
        SurveyDetail survey,
        IReadOnlyDictionary<string, string?> demographics,
        SurveyParticipantInput? participant = null,
        bool isComplete = true)
        => _factory.CreateClient().PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "4")],
            SessionId: Guid.NewGuid().ToString("N"),
            IsComplete: isComplete,
            Demographics: demographics,
            Participant: participant));

    private async Task AnswerAsAreaAsync(SurveyDetail survey, Guid departmentId, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var http = await SubmitAsync(survey, Area(departmentId));
            Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        }
    }

    private async Task<SurveyRespondView> RespondViewAsync(HttpClient client, Guid surveyId)
    {
        var http = await client.GetAsync($"/surveys/{surveyId}/respond");
        http.EnsureSuccessStatusCode();
        return (await http.Content.ReadFromJsonAsync<SurveyRespondView>())!;
    }

    private Task<List<string>> ScalarListAsync(string sql)
        => _harness.WithDbAsync(db => db.Database.SqlQueryRaw<string>(sql).ToListAsync());

    private Task SeedUserAsync(string name, string email, bool isActive)
        => _harness.WithDbAsync(async db =>
        {
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = email,
                Name = name,
                Role = Roles.Employee,
                IsActive = isActive,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            return await db.SaveChangesAsync();
        });
}
