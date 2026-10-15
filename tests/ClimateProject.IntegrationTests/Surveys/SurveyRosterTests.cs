using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;

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
    /// The guarantee this must not break. An anonymous survey writes no <c>user_id</c>, so the
    /// roster can name nobody as having answered -- it fails CLOSED on the absence of data
    /// rather than on a flag that could be read from the wrong column.
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
        Assert.All(view.Roster, row => Assert.Equal(SurveyParticipantStatuses.NotStarted, row.Status));

        // The roster still lists her -- who was invited, her username and her demographics are
        // the administrator's to see, and a resend still works. What the screen must not do is
        // call that `not_started` a fact about whether she answered.
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

    private Task<Guid> SeedPersonAsync(string name, string role, string? username = null)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var person = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                DepartmentId = null,
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
