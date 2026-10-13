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
    /// Operaciones, 4 in Ventas, 1 in Finanzas. The undisclosed remainder is 5, so Operaciones
    /// is published; Ventas and Finanzas are under the floor and carry no number at all.
    /// Mutate <c>SelfDeclaredDepartment.Effective</c> to return only the stored department and
    /// the Operaciones row disappears.
    /// </summary>
    [Fact]
    public async Task Five_self_declared_respondents_fill_their_departments_row_and_four_do_not()
    {
        var survey = await QrSurveyAsync(collectIdentity: false);
        await AnswerAsAreaAsync(survey, _operaciones, 5);
        await AnswerAsAreaAsync(survey, _ventas, 4);
        await AnswerAsAreaAsync(survey, _finanzas, 1);

        var admin = await AdminAsync();
        var statistics = (await admin.GetFromJsonAsync<SurveyStatisticsResponse>($"/surveys/{survey.Id}/statistics"))!;
        var departments = Assert.Single(statistics.Breakdowns, b => b.Dimension == "department");

        var operaciones = Assert.Single(departments.Segments, s => s.Key == _operaciones.ToString());
        Assert.False(operaciones.IsSuppressed);
        Assert.Equal(5, operaciones.RespondentCount);
        Assert.NotEmpty(operaciones.Questions);

        // Since #543 a withheld group is counted, never named: Ventas (4) and Finanzas (1)
        // are absent from the rows and present only in the counter.
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
    public async Task A_survey_created_without_a_word_about_it_collects_participant_identity()
    {
        var admin = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyId) with
        {
            Settings = new SurveySettingsInput(Anonymous: true),
        });

        Assert.True(survey.Settings.CollectParticipantIdentity);

        var off = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyId) with
        {
            Settings = new SurveySettingsInput(Anonymous: true, CollectParticipantIdentity: false),
        });
        Assert.False(off.Settings.CollectParticipantIdentity);
    }

    [Fact]
    public async Task The_respond_view_asks_a_visitor_and_never_a_signed_in_respondent()
    {
        var asking = await QrSurveyAsync(collectIdentity: true);
        var silent = await QrSurveyAsync(collectIdentity: false);
        var employee = await _harness.ClientAsync(Roles.Employee, _companyId, _operaciones);

        Assert.True((await RespondViewAsync(_factory.CreateClient(), asking.Id)).AsksParticipantIdentity);
        Assert.False((await RespondViewAsync(_factory.CreateClient(), silent.Id)).AsksParticipantIdentity);
        Assert.False((await RespondViewAsync(employee, asking.Id)).AsksParticipantIdentity);
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
    public async Task Completing_records_who_answered_in_a_row_that_cannot_be_joined_to_the_answers()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        var http = await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput("  Ana   Pérez ", " Ana@Planta.TEST "));
        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        var responseId = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId;

        var columns = await ScalarListAsync(
            "SELECT column_name AS \"Value\" FROM information_schema.columns WHERE table_name = 'survey_participations' ORDER BY column_name");
        Assert.Equal(["company_id", "email", "id", "name", "participated_on", "survey_id"], columns);

        var participation = Assert.Single(await _harness.WithDbAsync(db => db.SurveyParticipations
            .AsNoTracking().Where(p => p.SurveyId == survey.Id).ToListAsync()));
        Assert.Equal("Ana Pérez", participation.Name);
        Assert.Equal("ana@planta.test", participation.Email);
        Assert.Equal(_companyId, participation.CompanyId);
        Assert.NotEqual(responseId, participation.Id);
        Assert.InRange(
            participation.ParticipatedOn,
            DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
            DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)));

        var responseXmin = Assert.Single(await ScalarListAsync(
            $"SELECT xmin::text AS \"Value\" FROM responses WHERE \"Id\" = '{responseId}'"));
        var participationXmin = Assert.Single(await ScalarListAsync(
            $"SELECT xmin::text AS \"Value\" FROM survey_participations WHERE id = '{participation.Id}'"));
        // GREATER, not merely different -- and the first version of this assertion was
        // "different", which a compiling mutation (write moved inside the response transaction)
        // passed: EF Core's SaveChanges takes a SAVEPOINT inside a user transaction, so the
        // response row carries the subtransaction's xid while a same-transaction participation
        // row carries the parent's, and the two differ anyway. A participation written by a
        // LATER transaction, after commit, has a larger xid; one written in the same
        // transaction has an equal (no savepoint) or smaller (savepoint) one.
        Assert.True(
            long.Parse(participationXmin, CultureInfo.InvariantCulture) > long.Parse(responseXmin, CultureInfo.InvariantCulture),
            $"participation xmin {participationXmin} must be later than response xmin {responseXmin}");

        // And the response itself carries no trace of who.
        var row = await _harness.WithDbAsync(db => db.Responses.AsNoTracking().FirstAsync(r => r.Id == responseId));
        Assert.Null(row.UserId);
        Assert.Null(row.IpAddress);
        Assert.Null(row.UserAgent);
    }

    [Fact]
    public async Task A_name_without_an_email_is_enough()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        var http = await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput("José Mora"));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        var participation = Assert.Single(await _harness.WithDbAsync(db => db.SurveyParticipations
            .AsNoTracking().Where(p => p.SurveyId == survey.Id).ToListAsync()));
        Assert.Null(participation.Email);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("   ", "ana@planta.test")]
    [InlineData("Ana", "not-an-email")]
    [InlineData("Ana", "ana@@planta.test")]
    public async Task A_completing_post_without_a_valid_identity_is_refused_and_writes_nothing(string? name, string? email)
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        var http = await SubmitAsync(
            survey,
            Area(_operaciones),
            name is null && email is null ? null : new SurveyParticipantInput(name, email));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Equal(0, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
        Assert.Equal(0, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task A_partial_save_records_no_participation()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        var http = await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput("Ana", $"ana@{_mail}"), isComplete: false);

        Assert.True(http.IsSuccessStatusCode);
        Assert.Equal(0, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task Answering_twice_with_one_email_is_one_participation_and_never_blocks_the_response()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);

        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput("Ana", $"ana@{_mail}"))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(survey, Area(_ventas), new SurveyParticipantInput("Ana P.", $"ANA@{_mail}"))).StatusCode);

        Assert.Equal(2, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id && r.IsComplete)));
        Assert.Equal(1, await _harness.WithDbAsync(db => db.SurveyParticipations.CountAsync(p => p.SurveyId == survey.Id)));
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
    public async Task An_admin_sees_who_answered_and_who_is_pending_and_nothing_else()
    {
        var survey = await QrSurveyAsync(collectIdentity: true);
        await SeedUserAsync("Ana Pérez", $"ana@{_mail}", isActive: true);
        await SeedUserAsync("Bruno Solís", $"bruno@{_mail}", isActive: true);
        await SeedUserAsync("Carla Ruiz", $"carla@{_mail}", isActive: false);
        await SubmitAsync(survey, Area(_operaciones), new SurveyParticipantInput("Ana Pérez", $"ANA@{_mail}"));
        await SubmitAsync(survey, Area(_ventas), new SurveyParticipantInput("Operario sin correo"));

        var admin = await AdminAsync();
        var http = await admin.GetAsync($"/surveys/{survey.Id}/participation");
        Assert.Equal(HttpStatusCode.OK, http.StatusCode);
        var json = await http.Content.ReadAsStringAsync();
        var view = JsonSerializer.Deserialize<SurveyParticipationView>(json, JsonOptions)!;

        Assert.True(view.CollectsParticipantIdentity);
        Assert.Equal(2, view.AnsweredCount);
        Assert.Equal(["Ana Pérez", "Operario sin correo"], view.Answered.Select(a => a.Name));
        Assert.Equal($"ana@{_mail}", view.Answered[0].Email);

        Assert.Contains(view.Pending, p => p.Email == $"bruno@{_mail}");
        Assert.DoesNotContain(view.Pending, p => p.Email == $"ana@{_mail}");
        Assert.DoesNotContain(view.Pending, p => p.Email == $"carla@{_mail}");
        Assert.Equal(view.Pending.Count, view.PendingCount);

        // Nothing about answers, areas or timing travels: the shape has no such member.
        using var document = JsonDocument.Parse(json);
        Assert.Equal(
            ["answered", "answeredCount", "collectsParticipantIdentity", "pending", "pendingCount", "surveyId"],
            document.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal(
            ["email", "name", "participatedOn"],
            document.RootElement.GetProperty("answered")[0].EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
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
    /// no department FK -- their área feeds the department breakdown under the floor of 5
    /// (five in one área publish it, four publish no number), and who answered lands in a
    /// participation row that has no column that could point at the response.
    /// </summary>
    [Fact]
    public async Task A_visitor_answers_an_identified_survey_by_link_anonymously_and_their_area_and_attendance_are_counted_apart()
    {
        var survey = await QrSurveyAsync(collectIdentity: true, anonymous: false);
        var stored = await _harness.WithDbAsync(db => db.Surveys.AsNoTracking().FirstAsync(s => s.Id == survey.Id));
        Assert.False(stored.Settings.Anonymous);

        // The respond view tells the visitor the truth about THEIR answer, and asks both steps.
        var view = await RespondViewAsync(_factory.CreateClient(), survey.Id);
        Assert.True(view.Anonymous);
        Assert.True(view.AsksParticipantIdentity);
        Assert.Contains(view.Demographics, d => d.Field == SelfDeclaredDepartment.FieldKey);

        var responseIds = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            var http = await SubmitAsync(
                survey, Area(_operaciones), new SurveyParticipantInput($"Persona {i}", $"persona{i}@{_mail}"));
            Assert.Equal(HttpStatusCode.Created, http.StatusCode);
            responseIds.Add((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);
        }
        for (var i = 0; i < 4; i++)
        {
            var http = await SubmitAsync(
                survey, Area(_ventas), new SurveyParticipantInput($"Vendedor {i}", null));
            Assert.Equal(HttpStatusCode.Created, http.StatusCode);
            responseIds.Add((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);
        }
        // One more, elsewhere: withheld groups must total >= 5 or #543's complement rule
        // withholds Operaciones too (5 shown + 4 withheld would let a reader subtract to 4).
        var finanzas = await SubmitAsync(survey, Area(_finanzas), new SurveyParticipantInput("Contadora", $"contadora@{_mail}"));
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

        // Who answered: ten rows, none of which can be joined to an answer.
        var columns = await ScalarListAsync(
            "SELECT column_name AS \"Value\" FROM information_schema.columns WHERE table_name = 'survey_participations' ORDER BY column_name");
        Assert.Equal(["company_id", "email", "id", "name", "participated_on", "survey_id"], columns);

        var participations = await _harness.WithDbAsync(db => db.SurveyParticipations.AsNoTracking()
            .Where(p => p.SurveyId == survey.Id).ToListAsync());
        Assert.Equal(10, participations.Count);
        Assert.Contains(participations, p => p.Name == "Persona 0" && p.Email == $"persona0@{_mail}");
        Assert.Equal(4, participations.Count(p => p.Email is null));
        Assert.All(participations, p => Assert.DoesNotContain(p.Id, responseIds));
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
