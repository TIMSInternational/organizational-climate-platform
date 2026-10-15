using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// "Has this person answered?" for respondents who hold an ACCOUNT.
///
/// <para>
/// `survey_participations` is written only for a respondent with no account
/// (<c>participation-is-not-linked-to-answers.md</c>), and the 2026-10-13 identity ruling then
/// switched off the step that fed it. So on a mass invite -- where every respondent has an
/// account -- the table is empty, and this screen reported 0 answered with the whole roster
/// pending no matter how many people had answered. On ESPH's 800 that is the screen the
/// administrator watches all launch day.
/// </para>
///
/// <para>
/// The answer was never missing: an identified response carries <c>responses.user_id</c>, the
/// same column that enforces one-response-per-person. These tests pin that it is read, and --
/// just as important -- that an ANONYMOUS survey still gives nobody up, because there the
/// column is never written.
/// </para>
/// </summary>
[Collection("Postgres")]
public class WhoAnsweredForAccountsTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private readonly string _mail;
    private Guid _companyId;
    private Guid _authorId;

    public WhoAnsweredForAccountsTests(PostgresContainerFixture postgres)
    {
        _mail = $"wa-{Guid.NewGuid():N}.test";
        _harness = new SurveyTestHarness(postgres.App, _mail);
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Quien Respondio SA");
        _authorId = await SeedPersonAsync("Autora", Roles.CompanyAdmin);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task A_mass_invite_account_that_finished_is_listed_as_having_answered()
    {
        var marta = await SeedPersonAsync("Marta Villalobos", Roles.Employee);
        var survey = await SeedSurveyAsync(anonymous: false);
        await SeedResponseAsync(survey, marta, complete: true);

        var view = await ParticipationAsync(survey);

        Assert.Equal(1, view.AnsweredCount);
        Assert.Contains(view.Answered, row => row.Name == "Marta Villalobos");
        // And removed from Pending: a person counted in both would be chased for an answer
        // they already gave.
        Assert.DoesNotContain(view.Pending, row => row.Name == "Marta Villalobos");
    }

    [Fact]
    public async Task Someone_who_has_not_finished_is_still_pending()
    {
        var hugo = await SeedPersonAsync("Hugo Peralta", Roles.Employee);
        var survey = await SeedSurveyAsync(anonymous: false);
        await SeedResponseAsync(survey, hugo, complete: false);

        var view = await ParticipationAsync(survey);

        Assert.Equal(0, view.AnsweredCount);
        Assert.Contains(view.Pending, row => row.Name == "Hugo Peralta");
    }

    /// <summary>
    /// The guarantee this must not break. An anonymous survey writes no <c>user_id</c>, so the
    /// query finds nothing -- it fails CLOSED on the absence of data rather than on a flag that
    /// could be read from the wrong column, which is how the respond flow and this screen
    /// disagreed before (`cd4cadec`).
    /// </summary>
    [Fact]
    public async Task An_anonymous_survey_still_names_nobody()
    {
        var ana = await SeedPersonAsync("Ana Lucía Mora", Roles.Employee);
        var survey = await SeedSurveyAsync(anonymous: true);
        await SeedResponseAsync(survey, ana, complete: true, withUserId: false);

        var view = await ParticipationAsync(survey);

        Assert.Equal(0, view.AnsweredCount);
        Assert.Empty(view.Answered);
    }

    private async Task<SurveyParticipationView> ParticipationAsync(Guid surveyId)
    {
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var response = await client.GetAsync($"/surveys/{surveyId}/participation");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyParticipationView>())!;
    }

    private Task<Guid> SeedPersonAsync(string name, string role)
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
                Role = role,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Users.Add(person);
            await db.SaveChangesAsync();
            return person.Id;
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
