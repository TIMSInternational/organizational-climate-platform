using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// G9: a per-survey send to more than 100 people. It used to be refused outright with a raw
/// 400 -- "This request resolves to 617 recipients; the maximum per request is 100" -- and
/// ESPH's launch went out through a shell script nine slots of 100 at a time.
///
/// <para>The cap stays: each recipient costs a bcrypt-12 hash and an outbound message, and App
/// Runner kills a request at 120 s. What changed is what it is counted against (the people who
/// still hold no key) and what happens above it (the first 100 are processed and the response
/// says how many remain), so the same request, repeated, reaches everyone.</para>
///
/// <para>The hasher here is the REAL one (<c>BcryptPasswordHasher</c>, work factor 12), so the
/// per-call times this class logs are the measured cost of a full batch, not an estimate.</para>
/// </summary>
[Collection("Postgres")]
public class PerSurveyBatchedSendTests(
    PostgresContainerFixture postgres,
    CapturingCredentialsHostFixture credentials,
    ITestOutputHelper output)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    /// <summary>App Runner's hard request ceiling (`reference_app_runner_kills_a_request_at_120s`).</summary>
    private static readonly TimeSpan AppRunnerRequestCeiling = TimeSpan.FromSeconds(120);

    private readonly string _domain = $"batch-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Servicio Público de Heredia",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
            Settings = new CompanySettings { Language = "es", CredentialMode = CredentialModes.PerSurvey },
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd")))
            .EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient client, string? credentialMode = null)
    {
        var request = SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both("Clima", "Clima"));
        if (credentialMode is not null)
        {
            request = request with { Settings = new SurveySettingsInput(CredentialMode: credentialMode) };
        }

        var created = await SurveyTestHarness.CreateSurveyAsync(client, request);
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    /// <summary>
    /// <paramref name="count"/> employees in one write, returned in the order the server's batch
    /// walks them (<see cref="Guid.CompareTo(Guid)"/>), so a test can choose who is first.
    /// </summary>
    private async Task<List<(Guid Id, string Email)>> SeedEmployeesAsync(int count)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var people = Enumerable.Range(0, count)
            .Select(_ => (Id: Guid.NewGuid(), Email: $"{Guid.NewGuid():N}@persona.example.com"))
            .OrderBy(p => p.Id)
            .ToList();
        db.Users.AddRange(people.Select(p => new User
        {
            Id = p.Id,
            CompanyId = _companyId,
            Email = p.Email,
            Name = "Persona",
            Role = Roles.Employee,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        }));
        await db.SaveChangesAsync();
        return people;
    }

    private async Task<SurveyInvitationBatchResult> SendAsync(HttpClient client, Guid surveyId, List<Guid> userIds, int call)
    {
        var clock = Stopwatch.StartNew();
        var response = await client.PostAsJsonAsync(
            $"/surveys/{surveyId}/invitations", new CreateSurveyInvitationsRequest(UserIds: userIds));
        clock.Stop();
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!;

        // The measurement the cap rests on. Asserted beside a non-empty batch, because a call
        // that hashed nobody would pass any time limit (a timing test rewards doing nothing).
        output.WriteLine(
            $"call {call}: {clock.ElapsedMilliseconds} ms, issued {result.CredentialsIssued}, "
            + $"not sent {result.CredentialsNotSent}, remaining {result.Remaining}");
        if (result.CredentialsIssued + result.CredentialsNotSent > 0)
        {
            Assert.True(
                clock.Elapsed < AppRunnerRequestCeiling,
                $"call {call} took {clock.Elapsed.TotalSeconds:F1} s for {result.CredentialsIssued + result.CredentialsNotSent} keys");
        }

        return result;
    }

    /// <summary>
    /// 250 targeted, one of whom refuses every send. Three calls of the same request reach all
    /// of them, at most 100 keys each, and the response says each time how many are left.
    ///
    /// <para>The refusing address is deliberately FIRST in the order the batch walks, which is
    /// what makes the second call's 100 meaningful: a failed recipient is retried only after
    /// everybody never attempted. Ordered by id alone, they would head every batch and the second
    /// call would issue 99.</para>
    /// </summary>
    [Fact]
    public async Task A_per_survey_audience_of_250_goes_out_in_three_calls_of_at_most_100()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);
        var people = await SeedEmployeesAsync(250);
        var refusing = people[0].Email;
        _factory.FailFor.Add(refusing);
        var ids = people.Select(p => p.Id).ToList();

        var first = await SendAsync(admin, survey.Id, ids, 1);
        Assert.Equal(250, first.Requested);
        Assert.Equal(100, first.Created);
        Assert.Equal(99, first.CredentialsIssued);
        Assert.Equal(1, first.CredentialsNotSent);
        Assert.Equal([refusing], first.CredentialsNotSentEmails);
        Assert.Equal(151, first.Remaining);

        var second = await SendAsync(admin, survey.Id, ids, 2);
        Assert.Equal(100, second.CredentialsIssued);
        Assert.Equal(0, second.CredentialsNotSent);
        Assert.Equal(51, second.Remaining);

        var third = await SendAsync(admin, survey.Id, ids, 3);
        Assert.Equal(50, third.CredentialsIssued);
        Assert.Equal(1, third.CredentialsNotSent);
        Assert.Equal([refusing], third.CredentialsNotSentEmails);
        Assert.Equal(1, third.Remaining);

        // Everyone but the refusing address holds exactly one key, mailed exactly once.
        var mail = _factory.Sent.Where(m => people.Any(p => p.Email == m.ToEmail)).ToList();
        Assert.Equal(249, mail.Count);
        Assert.Equal(249, mail.Select(m => m.ToEmail).Distinct().Count());
        Assert.DoesNotContain(mail, m => m.ToEmail == refusing);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(249, await db.SurveyCredentials.CountAsync(c => c.SurveyId == survey.Id));
        Assert.Equal(250, await db.SurveyInvitations.CountAsync(i => i.SurveyId == survey.Id));
    }

    /// <summary>
    /// A send that stopped part-way -- the page closed, a request failed -- is resumed by running
    /// the same request again, and only the people still without a key are touched: nobody who
    /// holds one is re-keyed or mailed twice. And the invitation list reports the same state.
    /// </summary>
    [Fact]
    public async Task A_re_run_after_a_partial_send_mails_only_the_remainder()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);
        var people = await SeedEmployeesAsync(130);
        var ids = people.Select(p => p.Id).ToList();

        var partial = await SendAsync(admin, survey.Id, ids, 1);
        Assert.Equal(100, partial.CredentialsIssued);
        Assert.Equal(30, partial.Remaining);

        var listed = (await admin.GetFromJsonAsync<SurveyInvitationListResponse>($"/surveys/{survey.Id}/invitations"))!;
        Assert.Equal(CredentialModes.PerSurvey, listed.CredentialMode);
        Assert.Equal(100, listed.Summary.Total);
        Assert.Equal(100, listed.Summary.WithCode);
        Assert.All(listed.Invitations, i => Assert.True(i.HasCode));

        var rest = await SendAsync(admin, survey.Id, ids, 2);
        Assert.Equal(30, rest.Created);
        Assert.Equal(30, rest.CredentialsIssued);
        Assert.Equal(0, rest.Remaining);

        var again = await SendAsync(admin, survey.Id, ids, 3);
        Assert.Equal(0, again.Created);
        Assert.Equal(0, again.CredentialsIssued);
        Assert.Equal(0, again.Remaining);

        var mail = _factory.Sent.Where(m => people.Any(p => p.Email == m.ToEmail)).ToList();
        Assert.Equal(130, mail.Count);
        Assert.Equal(130, mail.Select(m => m.ToEmail).Distinct().Count());

        var after = (await admin.GetFromJsonAsync<SurveyInvitationListResponse>($"/surveys/{survey.Id}/invitations"))!;
        Assert.Equal(130, after.Summary.WithCode);
    }

    /// <summary>
    /// Shared mode keeps its behaviour: no keys, no batching, the 500 ceiling refused as before,
    /// and nothing ever "remaining".
    /// </summary>
    [Fact]
    public async Task A_shared_survey_still_refuses_more_than_500_and_reports_nothing_remaining()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var people = await SeedEmployeesAsync(501);

        var tooMany = await admin.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations",
            new CreateSurveyInvitationsRequest(UserIds: people.Select(p => p.Id).ToList()));
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);

        var ok = await SendAsync(admin, survey.Id, people.Take(500).Select(p => p.Id).ToList(), 1);
        Assert.Equal(500, ok.Created);
        Assert.Equal(0, ok.CredentialsIssued);
        Assert.Equal(0, ok.Remaining);

        var listed = (await admin.GetFromJsonAsync<SurveyInvitationListResponse>($"/surveys/{survey.Id}/invitations"))!;
        Assert.Equal(CredentialModes.Shared, listed.CredentialMode);
        Assert.Equal(0, listed.Summary.WithCode);
    }
}
