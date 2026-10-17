using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// The roster an administrator watches on launch day: for every invited person, which of the
/// THREE states they are in, how they sign in, and the demographics they were imported with.
///
/// <para>
/// Two states were not enough. "Pendiente" meant both "never opened it" and "answered half and
/// was interrupted", and those call for opposite actions -- the first needs their sign-in
/// details again, the second already has them. On 800 people an administrator cannot tell them
/// apart from one pending list, which is the whole reason this surface exists.
/// </para>
///
/// <para>
/// The state is derived from <c>responses</c> and never from <c>survey_invitations.status</c>:
/// that column's <c>started</c> is written only by the token-addressed route, which a
/// mass-invite respondent signing in with a username never passes through.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SurveyRosterTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private readonly string _tag = Guid.NewGuid().ToString("N")[..8];
    private readonly string _mail;
    private Guid _companyId;
    private Guid _authorId;

    public SurveyRosterTests(PostgresContainerFixture postgres)
    {
        _mail = $"roster-{Guid.NewGuid():N}.test";
        _harness = new SurveyTestHarness(postgres.App, _mail);
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Roster SA");
        _authorId = await SeedPersonAsync("Autora", Roles.CompanyAdmin);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// A generated username in the shape the platform actually mints -- prefix, hyphen, eight
    /// characters from an alphabet with no vowels. Unique per seed because
    /// <c>IX_users_username</c> is global, not per company, and every test in this class shares
    /// one container.
    /// </summary>
    private string Username(string who) => $"{_tag}-{who}";

    [Fact]
    public async Task Each_person_lands_in_exactly_one_of_the_three_states()
    {
        var finished = await SeedPersonAsync("Marta Villalobos", Roles.Employee, username: Username("marta"));
        var halfway = await SeedPersonAsync("Hugo Peralta", Roles.Employee, username: Username("hugo"));
        var untouched = await SeedPersonAsync("Ana Lucía Mora", Roles.Employee, username: Username("ana"));

        var survey = await SeedSurveyAsync(anonymous: false);
        await SeedResponseAsync(survey, finished, complete: true);
        await SeedResponseAsync(survey, halfway, complete: false);

        var view = await ParticipationAsync(survey);

        Assert.Equal(SurveyParticipantStatuses.Completed, StatusOf(view, "Marta Villalobos"));
        Assert.Equal(SurveyParticipantStatuses.Started, StatusOf(view, "Hugo Peralta"));
        Assert.Equal(SurveyParticipantStatuses.NotStarted, StatusOf(view, "Ana Lucía Mora"));

        // The counts are the three buckets and nothing is double-counted. The author is on the
        // roster too and has answered nothing, so she is not_started with the rest.
        Assert.Equal(1, view.AnsweredCount);
        Assert.Equal(1, view.StartedCount);
        Assert.Equal(3, view.NotStartedCount);
        Assert.Equal(view.Roster.Count, view.AnsweredCount + view.StartedCount + view.NotStartedCount);
    }

    /// <summary>
    /// The defect this replaces: someone halfway through was indistinguishable from someone who
    /// never opened it, and both were chased with the same mail.
    /// </summary>
    [Fact]
    public async Task Someone_halfway_is_not_reported_as_never_having_started()
    {
        var halfway = await SeedPersonAsync("Hugo Peralta", Roles.Employee);
        var survey = await SeedSurveyAsync(anonymous: false);
        await SeedResponseAsync(survey, halfway, complete: false);

        var view = await ParticipationAsync(survey);

        Assert.Equal(SurveyParticipantStatuses.Started, StatusOf(view, "Hugo Peralta"));
        Assert.NotEqual(SurveyParticipantStatuses.NotStarted, StatusOf(view, "Hugo Peralta"));
        // Still outstanding, though: the legacy pending list keeps both, because both still owe
        // an answer. The difference is what the administrator sends them.
        Assert.Contains(view.Pending, row => row.Name == "Hugo Peralta");
    }

    [Fact]
    public async Task The_row_carries_the_username_an_administrator_reads_back_on_the_phone()
    {
        var mailed = Username("marta");
        await SeedPersonAsync("Marta Villalobos", Roles.Employee, username: mailed);
        await SeedPersonAsync("Sin Usuario", Roles.Employee, username: null);
        var survey = await SeedSurveyAsync(anonymous: false);

        var view = await ParticipationAsync(survey);

        Assert.Equal(mailed, RowOf(view, "Marta Villalobos").Username);
        Assert.Equal(Roles.Employee, RowOf(view, "Marta Villalobos").Role);
        // Null, never invented: this account's holder chose their own password and there is no
        // generated username to read back.
        Assert.Null(RowOf(view, "Sin Usuario").Username);
    }

    [Fact]
    public async Task The_row_carries_the_demographics_the_import_uploaded()
    {
        var marta = await SeedPersonAsync("Marta Villalobos", Roles.Employee);
        await SeedDemographicAsync(marta, "puesto", "Gerente", order: 1);
        await SeedDemographicAsync(marta, "antiguedad", "Más de 10 años", order: 2);
        var survey = await SeedSurveyAsync(anonymous: false);

        var view = await ParticipationAsync(survey);
        var row = RowOf(view, "Marta Villalobos");

        // In the company's own field order, so the card reads the way the spreadsheet did.
        Assert.Equal(["puesto", "antiguedad"], row.Demographics.Select(d => d.Field));
        Assert.Equal(["Gerente", "Más de 10 años"], row.Demographics.Select(d => d.Value));
        // Nobody else's profile rides along on their row.
        Assert.Empty(RowOf(view, "Autora").Demographics);
    }

    /// <summary>
    /// The guarantee this must not break. An anonymous survey writes no <c>user_id</c>, so a
    /// response alone can name nobody as having answered -- the roster fails CLOSED on the
    /// absence of data rather than on a flag that could be read from the wrong column.
    ///
    /// <para>
    /// The response here is seeded directly and therefore has no <c>survey_participations</c>
    /// row beside it, which is exactly the shape this guards: a completed answer that nothing
    /// attributes to anybody must still credit nobody. What changed with completion tracking
    /// is only the NAME of the negative state -- <c>not_completed</c>, not
    /// <c>not_started</c> -- because on an anonymous survey "never opened it" is a claim the
    /// data cannot support, while "has not finished" is one it can.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_anonymous_survey_reports_nobody_as_having_answered()
    {
        var ana = await SeedPersonAsync("Ana Lucía Mora", Roles.Employee);
        var survey = await SeedSurveyAsync(anonymous: true);
        await SeedResponseAsync(survey, ana, complete: true, withUserId: false);

        var view = await ParticipationAsync(survey);

        Assert.Equal(0, view.AnsweredCount);
        Assert.Equal(0, view.StartedCount);

        // A RANDOM session id -- what a public link writes, and what every anonymous partial
        // carried before the derived id existed. It matches no account's derived id, so this
        // survey is demonstrably answerable WITHOUT signing in, and the roster must not claim
        // anybody never opened it: `not_completed`, not `not_started`. An earlier draft of this
        // change had it the other way and this test is what caught it.
        Assert.All(view.Roster, row => Assert.Equal(SurveyParticipantStatuses.NotCompleted, row.Status));

        // The roster still lists her -- who was invited, her username and her demographics are
        // the administrator's to see, and a resend still works. What the screen must not do is
        // call that a fact about whether she answered.
        Assert.False(view.TracksIndividuals);
        Assert.Contains(view.Roster, row => row.Name == "Ana Lucía Mora");
    }

    [Fact]
    public async Task An_identified_survey_says_the_state_can_be_trusted()
    {
        await SeedPersonAsync("Marta Villalobos", Roles.Employee, username: Username("marta"));
        var survey = await SeedSurveyAsync(anonymous: false);

        var view = await ParticipationAsync(survey);

        Assert.True(view.TracksIndividuals);
    }

    private static string StatusOf(SurveyParticipationView view, string name) => RowOf(view, name).Status;

    private static SurveyRosterRow RowOf(SurveyParticipationView view, string name)
        => view.Roster.Single(row => row.Name == name);

    private async Task<SurveyParticipationView> ParticipationAsync(Guid surveyId)
    {
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var response = await client.GetAsync($"/surveys/{surveyId}/participation");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyParticipationView>())!;
    }

    private Task<Guid> SeedPersonAsync(string name, string role, string? username = null, Guid? departmentId = null)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var person = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                DepartmentId = departmentId,
                Email = $"{Guid.NewGuid():N}@{_mail}",
                Name = name,
                Username = username,
                Role = role,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Users.Add(person);
            await db.SaveChangesAsync();
            return person.Id;
        });

    private Task SeedDemographicAsync(Guid userId, string field, string value, int order)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var definition = new DemographicField
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Field = field,
                LabelEs = field,
                LabelEn = field,
                Type = "select",
                Required = false,
                Order = order,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.DemographicFields.Add(definition);
            db.UserDemographics.Add(new UserDemographic
            {
                UserId = userId,
                DemographicFieldId = definition.Id,
                Value = value,
                CreatedAt = now,
                UpdatedAt = now,
            });
            await db.SaveChangesAsync();
            return 0;
        });

    /// <summary>
    /// An anonymous survey still says who FINISHED, because a completion is recorded apart
    /// from the answers.
    ///
    /// <para>
    /// This is the distinction the client drew and the one the screen used to collapse: an
    /// anonymous survey puts no <c>user_id</c> on an answer, so "opened it and stopped" cannot
    /// be attributed to anybody -- but a completion can, from <c>survey_participations</c>,
    /// which holds a name, an email and a calendar day and nothing that joins to an answer.
    /// So the roster reports two states here and not three, and the one it must NOT report is
    /// <c>not_started</c>: with no user id on the answers, somebody halfway through is
    /// indistinguishable from somebody who never opened it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_anonymous_survey_reports_who_finished_and_refuses_to_guess_at_the_rest()
    {
        var surveyId = await SeedSurveyAsync(anonymous: true);
        var finisher = await SeedPersonAsync("Ana Finisher", Roles.Employee, "esph-aaaa1111");
        var other = await SeedPersonAsync("Hugo Other", Roles.Employee, "esph-bbbb2222");

        // Written the way the respond flow writes it: from the account, with no answer in it.
        await SeedParticipationAsync(surveyId, finisher);

        // And one who is halfway, found by the id the respond flow derives for her rather than
        // by a user id her answers do not carry.
        var halfway = await SeedPersonAsync("Berta Halfway", Roles.Employee, "esph-dddd4444");
        await SeedDerivedPartialAsync(surveyId, halfway);

        var view = await ParticipationAsync(surveyId);

        // All three states, on an anonymous survey. This test used to assert the opposite, on
        // the grounds that a half-finished anonymous response belongs to nobody; the derived
        // session id is why that was wrong. `SurveyResumeSession` carries the reasoning,
        // including why reading it costs nothing that resume had not already spent.
        Assert.True(view.TracksIndividuals);
        Assert.False(view.TracksCompletionOnly);

        var ana = Assert.Single(view.Roster, row => row.UserId == finisher);
        var hugo = Assert.Single(view.Roster, row => row.UserId == other);
        var berta = Assert.Single(view.Roster, row => row.UserId == halfway);
        Assert.Equal(SurveyParticipantStatuses.Completed, ana.Status);
        Assert.Equal(SurveyParticipantStatuses.Started, berta.Status);

        // The one the client names last and acts on first: invited, never ingresó.
        Assert.Equal(SurveyParticipantStatuses.NotStarted, hugo.Status);

        // And the guarantee the whole design rests on, unchanged: the answers carry no user id.
        Assert.Equal(
            0,
            await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == surveyId && r.UserId != null)));
    }

    /// <summary>
    /// A non-anonymous survey is unchanged: it keeps all three states, because its answers do
    /// carry a user id and "stopped halfway" is therefore a fact about a person.
    /// </summary>
    [Fact]
    public async Task A_survey_that_stores_a_user_id_still_reports_all_three_states()
    {
        var surveyId = await SeedSurveyAsync(anonymous: false);
        var stopped = await SeedPersonAsync("Marta Halfway", Roles.Employee, "esph-cccc3333");
        await SeedResponseAsync(surveyId, stopped, complete: false);

        var view = await ParticipationAsync(surveyId);

        Assert.True(view.TracksIndividuals);
        Assert.False(view.TracksCompletionOnly);
        Assert.Equal(
            SurveyParticipantStatuses.Started,
            Assert.Single(view.Roster, row => row.UserId == stopped).Status);
    }

    /// <summary>
    /// Mirrors <c>SurveyResponseEndpoints.RecordAccountParticipationAsync</c>: the row is built
    /// from the account, lower-cased email, a calendar day, and nothing else.
    /// </summary>
    private Task SeedParticipationAsync(Guid surveyId, Guid userId)
        => _harness.WithDbAsync(async db =>
        {
            var person = await db.Users
                .Where(u => u.Id == userId)
                .Select(u => new { u.Name, u.Email })
                .SingleAsync();

            db.SurveyParticipations.Add(new SurveyParticipation
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                CompanyId = _companyId,
                Name = person.Name,
                Email = person.Email.Trim().ToLowerInvariant(),
                ParticipatedOn = DateOnly.FromDateTime(DateTime.UtcNow),
            });
            await db.SaveChangesAsync();
        });

    /// <summary>
    /// The roster is the SURVEY's audience, not the company's payroll.
    ///
    /// <para>
    /// Measured in the ESPH rehearsal on 2026-10-17: a survey aimed at ONE person by name
    /// listed all four accounts in the tenant, every one of the other three reading "no
    /// iniciada". On Monday's real company that is a 240-person survey listing 642 people,
    /// 402 of whom cannot see it, were never invited and are not expected to answer -- on the
    /// one screen an administrator opens to decide whom to chase.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_roster_lists_only_the_people_a_per_person_survey_is_aimed_at()
    {
        var aimedAt = await SeedPersonAsync("Audrey Herra", Roles.Employee, username: Username("audrey"));
        await SeedPersonAsync("Johanna Mena", Roles.Employee, username: Username("johanna"));
        await SeedPersonAsync("Andrés Tafur", Roles.Employee, username: Username("andres"));

        var surveyId = await SeedSurveyAsync(anonymous: false);
        await SeedUserTargetAsync(surveyId, aimedAt);

        var view = await ParticipationAsync(surveyId);

        var row = Assert.Single(view.Roster);
        Assert.Equal(aimedAt, row.UserId);

        // The counts are projections of the roster, so they move with it -- and the author,
        // who is not targeted, is off the list too.
        Assert.Equal(1, view.NotStartedCount);
        Assert.Equal(1, view.PendingCount);
        Assert.Equal(0, view.AnsweredCount);
    }

    /// <summary>
    /// The same defect for DEPARTMENT targets, which is how it predates per-person targeting:
    /// a survey aimed at one department listed every other department's people too.
    /// </summary>
    [Fact]
    public async Task The_roster_excludes_people_in_a_department_the_survey_does_not_target()
    {
        var targeted = await SeedDepartmentAsync("Agua Potable");
        var untargeted = await SeedDepartmentAsync("Energía Eléctrica");
        var inside = await SeedPersonAsync("Dentro Alcance", Roles.Employee, username: Username("dentro"), departmentId: targeted);
        await SeedPersonAsync("Fuera Alcance", Roles.Employee, username: Username("fuera"), departmentId: untargeted);

        var surveyId = await SeedSurveyAsync(anonymous: false);
        await SeedDepartmentTargetAsync(surveyId, targeted);

        var view = await ParticipationAsync(surveyId);

        var row = Assert.Single(view.Roster);
        Assert.Equal(inside, row.UserId);
    }

    /// <summary>
    /// And the mistake that would be worse than the one being fixed: a survey that targets
    /// NEITHER kind is company-wide, so its roster must stay the whole company. Reading an
    /// empty target list as "nobody" would empty every untargeted survey's roster.
    /// </summary>
    [Fact]
    public async Task A_survey_with_no_targets_of_either_kind_still_rosters_the_whole_company()
    {
        var first = await SeedPersonAsync("Primera Persona", Roles.Employee, username: Username("primera"));
        var second = await SeedPersonAsync("Segunda Persona", Roles.Employee, username: Username("segunda"));

        var surveyId = await SeedSurveyAsync(anonymous: false);

        var view = await ParticipationAsync(surveyId);

        Assert.Contains(view.Roster, row => row.UserId == first);
        Assert.Contains(view.Roster, row => row.UserId == second);
        Assert.Contains(view.Roster, row => row.UserId == _authorId);

        // EVERY active account with an address, counted from the database rather than from a
        // number written here: `ClientAsync` signs a caller up through `/auth/signup` and
        // re-homes them into this company, so reading the roster is itself what creates the
        // last of its rows. A literal would have encoded that and broken the day the harness
        // stopped doing it.
        var active = await _harness.WithDbAsync(db => db.Users
            .CountAsync(u => u.CompanyId == _companyId && u.IsActive && u.Email != ""));
        Assert.Equal(active, view.Roster.Count);
    }

    private Task<Guid> SeedDepartmentAsync(string name)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var department = new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Name = $"{name} {_tag}",
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Departments.Add(department);
            await db.SaveChangesAsync();
            return department.Id;
        });

    private Task SeedUserTargetAsync(Guid surveyId, Guid userId)
        => _harness.WithDbAsync(async db =>
        {
            db.SurveyUserTargets.Add(new SurveyUserTarget { SurveyId = surveyId, UserId = userId });
            await db.SaveChangesAsync();
            return 0;
        });

    private Task SeedDepartmentTargetAsync(Guid surveyId, Guid departmentId)
        => _harness.WithDbAsync(async db =>
        {
            db.SurveyDepartmentTargets.Add(new SurveyDepartmentTarget { SurveyId = surveyId, DepartmentId = departmentId });
            await db.SaveChangesAsync();
            return 0;
        });

    private Task<Guid> SeedSurveyAsync(bool anonymous)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var survey = new Survey
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                CreatedBy = _authorId,
                TitleEn = "Clima",
                TitleEs = "Clima",
                Language = "both",
                Type = "periodic",
                StartDate = now.AddDays(-1),
                EndDate = now.AddDays(10),
                Status = SurveyStatuses.Active,
                Settings = new SurveySettings { Anonymous = anonymous },
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Surveys.Add(survey);
            await db.SaveChangesAsync();
            return survey.Id;
        });

    /// <summary>
    /// A half-finished ANONYMOUS response carrying the id the respond flow would derive for
    /// this person -- computed with <see cref="SurveyResumeSession.IdFor"/> itself, never a
    /// copy of the HMAC input, so a fixture cannot certify a derivation the application does
    /// not use. The end-to-end proof that the two halves agree is
    /// <c>MassInviteTests.An_anonymous_roster_tells_never_opened_from_started_and_stopped</c>,
    /// which goes through the real endpoints; this is the cheap version for the state table.
    /// </summary>
    private Task SeedDerivedPartialAsync(Guid surveyId, Guid userId)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;

            // Asserted rather than null-forgiven: the suite's key is a non-empty constant, so a
            // null here would mean the derivation itself had stopped working, and writing a
            // null session id would turn that into a confusing status rather than a failure.
            var derivedId = SurveyResumeSession.IdFor(surveyId, userId, AuthWebApplicationFactory.TestJwtSecret);
            Assert.NotNull(derivedId);

            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                CompanyId = _companyId,
                UserId = null,
                DepartmentId = null,
                SessionId = derivedId,
                Language = "es",
                IsComplete = false,
                IsAnonymous = true,
                StartTime = now.AddMinutes(-5),
                CreatedAt = now,
                UpdatedAt = now,
            });
            await db.SaveChangesAsync();
            return 0;
        });

    private Task SeedResponseAsync(Guid surveyId, Guid userId, bool complete, bool withUserId = true)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                CompanyId = _companyId,
                UserId = withUserId ? userId : null,
                DepartmentId = null,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = "es",
                IsComplete = complete,
                IsAnonymous = !withUserId,
                StartTime = now.AddMinutes(-5),
                CompletionTime = complete ? now : null,
                TotalTimeSeconds = complete ? 300 : null,
                CreatedAt = now,
                UpdatedAt = now,
            });
            await db.SaveChangesAsync();
            return 0;
        });
}
