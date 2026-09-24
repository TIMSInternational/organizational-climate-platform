using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

/// <summary>
/// Licence enforcement on the microclimate submission path (#496, the half #497 did not close).
/// </summary>
/// <remarks>
/// <para>
/// <b>What was wrong.</b> <c>TryConsumeSeatAsync</c> had exactly one call site, in
/// <c>SurveyResponseEndpoints</c>. A microclimate is not a survey — separate entity, separate
/// endpoint — so a completed microclimate response spent no seat and the <c>microclimate</c>
/// licence a super admin could grant was inert. It was sold and not enforced.
/// </para>
/// <para>
/// <b>Why these are end-to-end and not unit tests.</b> The guarantee is about what the database
/// holds after a burst of concurrent HTTP submissions against real Postgres. The seat is consumed
/// before a lock-free optimistic-concurrency retry loop and released if that loop does not land,
/// so "no response is recorded without a seat, and no seat is spent without a response" is a
/// property of the two statements racing, which nothing in-memory can observe.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class MicroclimateResponseLicensingTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"mc-licence-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateResponseLicensingTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Microclimate Licence Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> action)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await action(db);
    }

    private async Task<string> AdminTokenAsync(HttpClient client)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Licence Admin", email, "A-good-passw0rd"));
        signup.EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    /// <summary>An ACTIVE, anonymous microclimate with one open-text question.</summary>
    private async Task<(Guid Id, Guid QuestionId)> ActiveMicroclimateAsync()
    {
        var client = _factory.CreateClient();
        var token = await AdminTokenAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var created = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            LocalizedInput.FromBare("Licence check"), null, _companyId,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 20, AnonymousResponses: true, TemplateId: null,
            Questions: [new CreateQuestionInput("How do you feel?", "open_ended", null, true, 1)]));
        created.EnsureSuccessStatusCode();
        var detail = await created.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var activated = await client.PutAsJsonAsync(
            $"/microclimates/{detail!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        activated.EnsureSuccessStatusCode();

        return (detail.Id, detail.Questions[0].Id);
    }

    private static Task<HttpResponseMessage> SubmitAsync(HttpClient client, Guid microclimateId, Guid questionId, string answer)
        => client.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = answer }));

    private Task GrantAsync(string service, int seats) => WithDbAsync(db =>
        CompanyLicenses.GrantOrUpdateAsync(db, _companyId, service, seats, null, DateTimeOffset.UtcNow, default));

    private Task<int> SeatsUsedAsync(string service) => WithDbAsync(db => db.CompanyServiceLicenses
        .AsNoTracking()
        .Where(l => l.CompanyId == _companyId && l.ServiceType == service)
        .Select(l => l.SeatsUsed)
        .FirstAsync());

    private Task<int> ResponseCountAsync(Guid microclimateId) => WithDbAsync(db => db.Microclimates
        .AsNoTracking().Where(m => m.Id == microclimateId).Select(m => m.ResponseCount).FirstAsync());

    /// <summary>
    /// <b>The reachability guard #496 asks for, for this half.</b> A granted <c>microclimate</c>
    /// licence must actually move when the endpoint the product calls is called.
    /// </summary>
    /// <remarks>
    /// This is the assertion whose absence let the defect ship, and it is deliberately written
    /// against the HTTP endpoint rather than the helper: the helper was always correct and always
    /// tested: what was missing was anybody calling it from here. Its sibling for surveys is
    /// <c>SurveyResponseLicensingTests.Every_metered_service_can_be_assigned_through_the_create_endpoint</c>.
    /// </remarks>
    [Fact]
    public async Task The_microclimate_service_is_spent_by_the_microclimate_endpoint()
    {
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();
        await GrantAsync(ClimateServiceTypes.Microclimate, 5);

        var response = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "good");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(1, await SeatsUsedAsync(ClimateServiceTypes.Microclimate));
        Assert.Equal(1, await ResponseCountAsync(microclimateId));
    }

    [Fact]
    public async Task A_submission_is_allowed_and_provisions_nothing_when_the_company_has_no_licence()
    {
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();

        var response = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "good");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(1, await ResponseCountAsync(microclimateId));

        // Grandfathered: no licence row was invented, so shipping this is inert until a super
        // admin grants one. A live microclimate must not start refusing on deploy day.
        var licences = await WithDbAsync(db => CompanyLicenses.ListAsync(db, _companyId, default));
        Assert.Empty(licences);
    }

    [Fact]
    public async Task An_exhausted_licence_refuses_the_submission_and_records_nothing()
    {
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();
        await GrantAsync(ClimateServiceTypes.Microclimate, 1);

        var first = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "good");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "stressed");

        Assert.Equal(HttpStatusCode.PaymentRequired, second.StatusCode);

        // The one seat was not oversold, and the refused submission left nothing behind --
        // ResponseCount is the only record a microclimate response has, so if it moved here
        // there would be no per-response row to unpick it by afterwards.
        Assert.Equal(1, await SeatsUsedAsync(ClimateServiceTypes.Microclimate));
        Assert.Equal(1, await ResponseCountAsync(microclimateId));
    }

    /// <summary>
    /// The refusal must not tell a respondent that their employer has run out of seats. The
    /// status code carries the distinction; the prose does not.
    /// </summary>
    [Fact]
    public async Task The_refusal_is_respondent_neutral_and_says_nothing_about_licences()
    {
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();
        await GrantAsync(ClimateServiceTypes.Microclimate, 0);

        var refused = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "good");

        Assert.Equal(HttpStatusCode.PaymentRequired, refused.StatusCode);
        var body = await refused.Content.ReadAsStringAsync();
        Assert.DoesNotContain("licen", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("seat", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pay", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_suspended_licence_refuses_the_submission()
    {
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();
        await GrantAsync(ClimateServiceTypes.Microclimate, 5);
        await WithDbAsync(db => CompanyLicenses.SetStatusAsync(
            db, _companyId, ClimateServiceTypes.Microclimate, LicenseStatuses.Suspended, DateTimeOffset.UtcNow, default));

        var response = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "good");

        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
        Assert.Equal(0, await SeatsUsedAsync(ClimateServiceTypes.Microclimate));
        Assert.Equal(0, await ResponseCountAsync(microclimateId));
    }

    /// <summary>
    /// A microclimate spends the <c>microclimate</c> licence and no other. Without this, "any
    /// active licence" and "the right licence" pass identically.
    /// </summary>
    [Fact]
    public async Task A_licence_for_another_service_is_not_spent()
    {
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();
        await GrantAsync(ClimateServiceTypes.GeneralClimate, 5);

        var response = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "good");

        // Grandfathered on its own service (no microclimate row), so it proceeds and spends
        // nothing -- least of all somebody else's seats.
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(0, await SeatsUsedAsync(ClimateServiceTypes.GeneralClimate));
    }

    /// <summary>
    /// A session that is already closed is refused by the status gate, which sits BEFORE the
    /// consume — so a submission that was never going to be recorded costs nothing.
    /// </summary>
    [Fact]
    public async Task A_closed_session_refuses_before_a_seat_is_taken()
    {
        var client = _factory.CreateClient();
        var token = await AdminTokenAsync(client);
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();
        await GrantAsync(ClimateServiceTypes.Microclimate, 5);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        (await client.PutAsJsonAsync($"/microclimates/{microclimateId}/status",
            new UpdateMicroclimateStatusRequest("closed"))).EnsureSuccessStatusCode();

        var response = await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, "good");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await SeatsUsedAsync(ClimateServiceTypes.Microclimate));
    }

    /// <summary>
    /// An answer rejected on its merits must not cost a seat either: validation runs before the
    /// consume, so a malformed submission is free.
    /// </summary>
    [Fact]
    public async Task An_invalid_answer_costs_no_seat()
    {
        var client = _factory.CreateClient();
        var token = await AdminTokenAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var created = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            LocalizedInput.FromBare("Rating only"), null, _companyId,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 20, AnonymousResponses: true, TemplateId: null,
            Questions: [new CreateQuestionInput("Rate it", "rating", null, true, 1)]));
        created.EnsureSuccessStatusCode();
        var detail = await created.Content.ReadFromJsonAsync<MicroclimateDetail>();
        (await client.PutAsJsonAsync($"/microclimates/{detail!.Id}",
            new UpdateMicroclimateRequest(null, null, "active", null))).EnsureSuccessStatusCode();

        await GrantAsync(ClimateServiceTypes.Microclimate, 5);

        var response = await SubmitAsync(_factory.CreateClient(), detail.Id, detail.Questions[0].Id, "99");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await SeatsUsedAsync(ClimateServiceTypes.Microclimate));
        Assert.Equal(0, await ResponseCountAsync(detail.Id));
    }

    /// <summary>
    /// <b>The burst.</b> A live microclimate is a room answering at once, which is the whole
    /// reason the submission path is lock-free and the whole reason the survey fix could not be
    /// copied onto it. Twelve concurrent submissions against three seats.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Two invariants have to hold together, and either one alone is passable by broken code:
    /// <b>exactly three succeed</b> (a consume that is not atomic oversells) and
    /// <b>ResponseCount equals the seats spent</b> (a consume that is not paired with the write
    /// records answers it did not charge for, or charges for answers it did not record).
    /// </para>
    /// <para>
    /// Each submission gets its own <c>HttpClient</c>, which is also its own rate-limiting
    /// identity under <c>AuthWebApplicationFactory</c> — twelve requests from one caller would be
    /// measuring the limiter rather than the licence.
    /// </para>
    /// <para>
    /// Modelled on <c>CompanyServiceLicenseTests.Concurrent_completions_never_oversell_the_last_seats</c>,
    /// which asserts the same property one layer down, on the helper alone.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task Concurrent_submissions_never_oversell_the_last_seats()
    {
        var (microclimateId, questionId) = await ActiveMicroclimateAsync();
        const int seats = 3;
        const int concurrency = 12;
        await GrantAsync(ClimateServiceTypes.Microclimate, seats);

        var responses = await Task.WhenAll(Enumerable.Range(0, concurrency).Select(async i =>
            await SubmitAsync(_factory.CreateClient(), microclimateId, questionId, $"word{i}")));

        Assert.Equal(seats, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.Equal(concurrency - seats, responses.Count(r => r.StatusCode == HttpStatusCode.PaymentRequired));

        // The licence was not oversold, and every seat spent bought exactly one recorded answer.
        Assert.Equal(seats, await SeatsUsedAsync(ClimateServiceTypes.Microclimate));
        Assert.Equal(seats, await ResponseCountAsync(microclimateId));
    }
}
