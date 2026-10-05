using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

[Collection("Postgres")]
public class MicroclimateLiveResultsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"live-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateLiveResultsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Live Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
        => SignUpAndGetTokenAsync(client, role, _companyDomain, _companyId);

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test Admin", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private async Task<(Guid Id, Guid QuestionId)> CreateActiveMicroclimateAsync(HttpClient client, string token, bool anonymous)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Live test", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, anonymous, null,
            new List<CreateQuestionInput> { new("How do you feel?", "open_ended", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        return (created.Id, created.Questions[0].Id);
    }

    [Fact]
    public async Task Submitting_anonymous_responses_requires_no_auth_token_and_updates_live_results()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        var anonymousClient = _factory.CreateClient(); // deliberately no Authorization header
        var response1 = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "good good great" }));
        Assert.Equal(HttpStatusCode.Created, response1.StatusCode);

        var response2 = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "good stressed" }));
        Assert.Equal(HttpStatusCode.Created, response2.StatusCode);

        anonymousClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await anonymousClient.GetAsync($"/microclimates/{microclimateId}/live-results");
        Assert.Equal(HttpStatusCode.OK, liveResponse.StatusCode);
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();
        Assert.Equal(2, live!.ResponseCount);
        // A word counts ONCE PER RESPONSE, not once per occurrence, because the stored tally is
        // read as a number of respondents by the word floor. response1 = "good good great"
        // contributes good:1 (not 2) and great:1; response2 = "good stressed" contributes good:1
        // and stressed:1. Counts still accumulate across responses, which is what this asserts.
        Assert.Contains(live.WordCloud, w => w.Text == "good" && w.Value == 2);
        // And the words only one respondent used are withheld: a word cloud leaks by
        // distinctiveness, so the floor is SurveyResultsPrivacy.MinimumWordRespondents.
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "great");
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "stressed");
    }

    [Fact]
    public async Task Non_anonymous_microclimate_requires_authentication_to_submit_a_response()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: false);

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "hello" }));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Word_cloud_only_counts_open_ended_answers_not_ratings_or_yes_no()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Mixed question types", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput>
            {
                new("How do you feel?", "open_ended", null, true, 1),
                new("Rate your week", "rating", null, true, 2),
                new("Are you happy?", "yes_no", null, true, 3),
            }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var openEndedQuestionId = created.Questions.Single(q => q.Type == "open_ended").Id;
        var ratingQuestionId = created.Questions.Single(q => q.Type == "rating").Id;
        var yesNoQuestionId = created.Questions.Single(q => q.Type == "yes_no").Id;

        // TWO respondents, saying the same things. One would leave every word on a count of 1,
        // where the word floor withholds it -- and an EMPTY cloud satisfies the two
        // DoesNotContain assertions below without proving anything, which is the shape this
        // test exists to catch. With two, "5" and "yes" would be on 2 and visible if they ever
        // leaked, so the negatives have teeth again.
        var anonymousClient = _factory.CreateClient();
        foreach (var _ in new[] { 1, 2 })
        {
            var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
                new Dictionary<Guid, string>
                {
                    [openEndedQuestionId] = "great amazing",
                    [ratingQuestionId] = "5",
                    [yesNoQuestionId] = "yes",
                }));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        anonymousClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await anonymousClient.GetAsync($"/microclimates/{created.Id}/live-results");
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();

        // The rating value "5" and the yes/no answer "yes" must not pollute the word cloud --
        // only the open_ended answer's words should be counted.
        Assert.DoesNotContain(live!.WordCloud, w => w.Text == "5");
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "yes");
        Assert.Contains(live.WordCloud, w => w.Text == "great" && w.Value == 2);
        Assert.Contains(live.WordCloud, w => w.Text == "amazing" && w.Value == 2);
    }

    [Fact]
    public async Task Non_anonymous_microclimate_rejects_a_response_from_a_different_companys_authenticated_user()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: false);

        var otherCompanyDomain = $"live-other-{Guid.NewGuid():N}.test";
        Guid otherCompanyId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var otherCompany = new Company { Id = Guid.NewGuid(), Name = "Other Co", EmailDomain = otherCompanyDomain, CreatedAt = DateTimeOffset.UtcNow };
            db.Companies.Add(otherCompany);
            otherCompanyId = otherCompany.Id;
            await db.SaveChangesAsync();
        }

        var otherClient = _factory.CreateClient();
        var otherToken = await SignUpAndGetTokenAsync(otherClient, Roles.CompanyAdmin, otherCompanyDomain, otherCompanyId);
        otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", otherToken);

        var response = await otherClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "hello" }));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // Confirm the cross-company attempt did not sneak through and inflate the aggregate.
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await client.GetAsync($"/microclimates/{microclimateId}/live-results");
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();
        Assert.Equal(0, live!.ResponseCount);
    }

    [Fact]
    public async Task Submitting_an_out_of_range_rating_is_rejected()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Rating validation", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput> { new("Rate your week", "rating", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var ratingQuestionId = created.Questions.Single().Id;

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [ratingQuestionId] = "9000" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Submitting_a_yes_no_answer_outside_yes_or_no_is_rejected()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Yes/no validation", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput> { new("Are you happy?", "yes_no", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var yesNoQuestionId = created.Questions.Single().Id;

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [yesNoQuestionId] = "maybe" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Submitting_a_multiple_choice_answer_outside_the_configured_options_is_rejected()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Multiple choice validation", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput> { new("Pick one", "multiple_choice", [new(null, "Red"), new(null, "Green"), new(null, "Blue")], true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var choiceQuestionId = created.Questions.Single().Id;

        var anonymousClient = _factory.CreateClient();
        var invalid = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [choiceQuestionId] = "Purple" }));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var valid = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [choiceQuestionId] = "Green" }));
        Assert.Equal(HttpStatusCode.Created, valid.StatusCode);
    }

    /// <summary>
    /// The defect #518 fixed for the survey cloud, which this surface kept: the TIMS dry run's
    /// cloud led with "el" 8, "la" 7, "y" 5 — the grammar of the answers, not what they were
    /// about. Spanish and English function words are dropped before counting, in the
    /// respondent's language, and are not counted as withheld.
    /// </summary>
    [Fact]
    public async Task Function_words_never_reach_the_word_cloud()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        var anonymousClient = _factory.CreateClient();
        foreach (var _ in new[] { 1, 2 })
        {
            // "es" explicitly: the stop list is per language, so the language the respondent
            // answered in is what decides which words are grammar. A Spanish answer filed under
            // "en" would keep every Spanish article, which is the bug this pins.
            var submitted = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
                new Dictionary<Guid, string> { [questionId] = "la comunicacion entre las areas y el equipo" },
                "es"));
            Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var live = await (await client.GetAsync($"/microclimates/{microclimateId}/live-results"))
            .Content.ReadFromJsonAsync<LiveResultsDetail>();

        // Both respondents said every one of these, so the floor is not what removes them.
        foreach (var functionWord in new[] { "la", "las", "y", "el", "entre" })
        {
            Assert.DoesNotContain(live!.WordCloud, w => w.Text == functionWord);
        }

        // ...and the words they actually chose survive.
        Assert.Contains(live!.WordCloud, w => w.Text == "comunicacion" && w.Value == 2);
        Assert.Contains(live.WordCloud, w => w.Text == "equipo" && w.Value == 2);
    }

    /// <summary>
    /// A legacy cloud does not just read clean, it is PURGED from storage by the next response.
    ///
    /// <para>The tally is kept as the top 20 words per language. A cloud written before the stop
    /// list can hold "el" 50 and "la" 40, which would spend those slots on grammar and push out
    /// the content words a new response contributes — and those are discarded at write, so
    /// hiding the stopwords at read time would leave a cloud that is empty rather than clean.
    /// Reading the row back is the only way to tell the two apart.</para>
    /// </summary>
    [Fact]
    public async Task A_new_response_purges_the_function_words_a_legacy_cloud_stored()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var microclimate = await db.Microclimates.FirstAsync(m => m.Id == microclimateId);
            microclimate.LiveResults.WordCloudData = System.Text.Json.JsonSerializer.Serialize(new[]
            {
                new WordCloudEntry("el", 50, "es"),
                new WordCloudEntry("la", 40, "es"),
                new WordCloudEntry("equipo", 2, "es"),
            });
            await db.SaveChangesAsync();
        }

        var anonymousClient = _factory.CreateClient();
        var submitted = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "el equipo" }, "es"));
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var microclimate = await db.Microclimates.AsNoTracking().FirstAsync(m => m.Id == microclimateId);
            var stored = System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData!)!;

            // Gone from the ROW, not merely filtered on the way out.
            Assert.DoesNotContain(stored, w => w.Text == "el");
            Assert.DoesNotContain(stored, w => w.Text == "la");
            // The content word kept its history and took this response's contribution.
            Assert.Contains(stored, w => w.Text == "equipo" && w.Value == 3);
        }
    }

    /// <summary>
    /// A cloud stored before the stop list existed is cleaned on the way out.
    ///
    /// <para>The write-side filter only sees new responses, so without this a microclimate
    /// answered before the fix keeps leading with "el" and "la" until enough new responses
    /// arrive to overwrite its tally. Measured on the local stack: a pulse answered minutes
    /// before the write fix still returned "más" 2 afterwards.</para>
    ///
    /// <para>The legacy shape is written straight to the row on purpose. It is the one shape
    /// the API can no longer produce, which is exactly why it has to be constructed here.</para>
    /// </summary>
    [Fact]
    public async Task A_cloud_stored_before_the_stop_list_is_cleaned_when_it_is_read()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, _) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var microclimate = await db.Microclimates.FirstAsync(m => m.Id == microclimateId);
            microclimate.LiveResults.WordCloudData = System.Text.Json.JsonSerializer.Serialize(new[]
            {
                new WordCloudEntry("la", 4, "es"),
                new WordCloudEntry("y", 3, "es"),
                new WordCloudEntry("equipo", 3, "es"),
                new WordCloudEntry("the", 2, "en"),
                new WordCloudEntry("workload", 2, "en"),
            });
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var live = await (await client.GetAsync($"/microclimates/{microclimateId}/live-results"))
            .Content.ReadFromJsonAsync<LiveResultsDetail>();

        // Every one of these cleared the floor on count; they go because of what they are.
        Assert.DoesNotContain(live!.WordCloud, w => w.Text == "la");
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "y");
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "the");
        // ...and the words the respondents actually chose survive, in both languages.
        Assert.Contains(live.WordCloud, w => w.Text == "equipo" && w.Value == 3);
        Assert.Contains(live.WordCloud, w => w.Text == "workload" && w.Value == 2);
    }

    /// <summary>
    /// The privacy property the floor exists for, and the reason a word is counted once per
    /// response rather than once per occurrence: otherwise one respondent repeating a word
    /// lifts it over a floor that is meant to mean "more than one person said this".
    /// </summary>
    [Fact]
    public async Task One_respondent_repeating_a_word_cannot_lift_it_over_the_floor()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        var anonymousClient = _factory.CreateClient();
        var alone = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "foco foco foco foco foco" }));
        Assert.Equal(HttpStatusCode.Created, alone.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var live = await (await client.GetAsync($"/microclimates/{microclimateId}/live-results"))
            .Content.ReadFromJsonAsync<LiveResultsDetail>();

        // Five occurrences, one respondent. The response was still recorded.
        Assert.Equal(1, live!.ResponseCount);
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "foco");
    }

    [Fact]
    public async Task Concurrent_response_submissions_do_not_lose_updates()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        const int concurrentSubmissions = 8;
        var tasks = Enumerable.Range(0, concurrentSubmissions).Select(async i =>
        {
            var anonymousClient = _factory.CreateClient();
            // "shared" is in EVERY submission on purpose: a word only one respondent used is
            // withheld by the word floor, so eight distinct words would leave an empty cloud
            // and nothing to count. The shared word's tally is exactly the number of
            // submissions that were not lost.
            return await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
                new Dictionary<Guid, string> { [questionId] = $"shared word{i}" }));
        });

        var responses = await Task.WhenAll(tasks);
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await client.GetAsync($"/microclimates/{microclimateId}/live-results");
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();

        // Without concurrency handling, concurrent read-modify-write races on ResponseCount /
        // WordCloudData would silently drop some increments (lost updates). Every submission
        // must be reflected.
        Assert.Equal(concurrentSubmissions, live!.ResponseCount);
        Assert.Contains(live.WordCloud, w => w.Text == "shared" && w.Value == concurrentSubmissions);
    }
}
