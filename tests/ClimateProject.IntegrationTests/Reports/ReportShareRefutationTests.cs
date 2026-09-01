using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

/// <summary>
/// The adversarial half of #139: each test here is an attack that would PASS if a guarantee
/// the share link makes were false, run against the real endpoints. They are kept separate
/// from <see cref="ReportShareEndpointsTests"/> because those tests assert what the feature
/// does; these assert what it must not let happen, and are written from the attacker's side.
///
/// <para>Every assertion is on the application's own verdict -- status AND body, plus the
/// rows the request did or did not leave behind -- never merely "not a 500".</para>
/// </summary>
[Collection("Postgres")]
public class ReportShareRefutationTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private readonly string _companyDomain = $"shr-ref-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportShareRefutationTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, _companyDomain);
    }

    public async Task InitializeAsync()
    {
        _companyId = await SeedCompanyAsync("Refuted Co", _companyDomain);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private sealed record Actor(HttpClient Client, Guid UserId, string Email);

    private Task<Guid> SeedCompanyAsync(string name, string? domain = null)
        => WithDbAsync(async db =>
        {
            var company = new Company
            {
                Id = Guid.NewGuid(),
                Name = name,
                EmailDomain = domain ?? $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Companies.Add(company);
            await db.SaveChangesAsync();
            return company.Id;
        });

    /// <summary>
    /// Signs up through the real endpoint, then sets role and company directly. A super admin
    /// is a user with no company at all, which is what <c>CompanyScope.CanAccess</c> expects.
    /// </summary>
    private async Task<Actor> ActorAsync(string role = Roles.CompanyAdmin, Guid? companyId = null, bool superAdmin = false)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Refuter", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = superAdmin ? Roles.SuperAdmin : role;
            user.CompanyId = superAdmin ? null : (companyId ?? _companyId);
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return new Actor(client, userId, email);
    }

    private static async Task<Guid> CreateReportAsync(HttpClient admin, Guid companyId, string title = "Refuted Report")
    {
        var response = await admin.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            title, "A quarter, summarised", "climate_summary", companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReportDetail>())!.Id;
    }

    private static async Task<CreateReportShareResponse> MintAsync(HttpClient admin, Guid reportId, int? days = null)
    {
        var response = await admin.PostAsJsonAsync($"/admin/reports/{reportId}/share", new CreateReportShareRequest(days));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreateReportShareResponse>())!;
    }

    private HttpClient AnonymousClient() => _factory.CreateClient();

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> work)
    {
        using var scope = _factory.Services.CreateScope();
        await work(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    private async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> work)
    {
        using var scope = _factory.Services.CreateScope();
        return await work(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    /// <summary>Everything a caller can compare between two responses. Mirrors the feature tests' shape.</summary>
    private static async Task<string> ObservableShape(HttpResponseMessage response)
    {
        string Header(string name) =>
            response.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : "(absent)";

        var contentType = response.Content.Headers.ContentType?.ToString() ?? "(absent)";
        var body = await response.Content.ReadAsStringAsync();
        return $"{(int)response.StatusCode} | ct={contentType} | robots={Header("X-Robots-Tag")} | " +
               $"cache={Header("Cache-Control")} | body={body}";
    }

    private Task<int> AccessCountAsync(Guid shareId)
        => WithDbAsync(async db => (await db.ReportShares.AsNoTracking().FirstAsync(s => s.Id == shareId)).AccessCount);

    private Task<int> SharedReadRowsAsync(Guid companyId)
        => WithDbAsync(db => db.AuditLogs.CountAsync(a => a.CompanyId == companyId && a.Resource == "shared.reports"));

    // ------------------------------------------------------------------
    // 1. Cross-tenant, from every angle the path allows
    // ------------------------------------------------------------------

    /// <summary>
    /// A company admin of B against A's report: refused with the verdict every other admin
    /// route in this codebase gives for a foreign tenant (403 after the existence check, as
    /// <c>ReportEndpoints.GetAsync</c> and <c>SurveyResultsEndpoints</c> do), and -- the part
    /// a status-only test cannot see -- nothing about A's link changed.
    ///
    /// Also the angle the path invites: B revoking A's share id through B's OWN report, where
    /// the company check passes and only the share-to-report scoping stands in the way.
    /// </summary>
    [Fact]
    public async Task A_foreign_admin_cannot_reach_or_alter_another_tenants_share_by_any_path()
    {
        var owner = await ActorAsync();
        var reportId = await CreateReportAsync(owner.Client, _companyId);
        var share = await MintAsync(owner.Client, reportId);

        var otherCompanyId = await SeedCompanyAsync("Other Co");
        var stranger = await ActorAsync(Roles.CompanyAdmin, otherCompanyId);
        var strangersReportId = await CreateReportAsync(stranger.Client, otherCompanyId, "Stranger's own");

        // Through A's report id: the house verdict for a foreign tenant.
        Assert.Equal(HttpStatusCode.Forbidden,
            (await stranger.Client.PostAsJsonAsync($"/admin/reports/{reportId}/share", new CreateReportShareRequest(7))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.Client.GetAsync($"/admin/reports/{reportId}/shares")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await stranger.Client.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}")).StatusCode);

        // Through the stranger's OWN report id, carrying A's share id: the company check passes
        // and only the (shareId, reportId) scoping is left. It must not find A's row.
        var smuggled = await stranger.Client.DeleteAsync($"/admin/reports/{strangersReportId}/shares/{share.Id}");
        Assert.Equal(HttpStatusCode.NotFound, smuggled.StatusCode);

        // And the stranger's listing of their own report does not carry A's link.
        var strangersList = await stranger.Client.GetFromJsonAsync<List<ReportShareSummary>>($"/admin/reports/{strangersReportId}/shares");
        Assert.Empty(strangersList!);

        // Outcomes: A still has exactly one link, unrevoked, and it still resolves.
        var ownersList = await owner.Client.GetFromJsonAsync<List<ReportShareSummary>>($"/admin/reports/{reportId}/shares");
        var only = Assert.Single(ownersList!);
        Assert.Equal(share.Id, only.Id);
        Assert.Null(only.RevokedAt);
        Assert.Equal(HttpStatusCode.OK, (await AnonymousClient().GetAsync(share.Path)).StatusCode);

        // The intended policy has one more clause -- a super admin may act in any tenant --
        // and it is asserted positively so a "fix" that locks the super admin out shows here.
        var superAdmin = await ActorAsync(superAdmin: true);
        Assert.Equal(HttpStatusCode.Created,
            (await superAdmin.Client.PostAsJsonAsync($"/admin/reports/{reportId}/share", new CreateReportShareRequest(null))).StatusCode);
    }

    // ------------------------------------------------------------------
    // 3. The public GET with everything a URL bar can hold
    // ------------------------------------------------------------------

    /// <summary>
    /// Every token a caller can put in the path that is not exactly a live one: the same
    /// 404 with the same body as a never-minted token, never a 200, never a 5xx -- and no
    /// audit row, no access counted.
    ///
    /// The case-flipped token is the important one: Base64Url is case-sensitive, so a token
    /// with one letter's case changed is a different credential, and a lookup that folded
    /// case (a citext column, an ILIKE, a ToLower on either side) would halve the keyspace
    /// and, worse, resolve a token nobody minted.
    /// </summary>
    [Fact]
    public async Task No_token_other_than_the_live_one_resolves_and_none_costs_an_audit_row()
    {
        var admin = await ActorAsync();
        var reportId = await CreateReportAsync(admin.Client, _companyId);
        var live = await MintAsync(admin.Client, reportId, days: 30);

        // Expired at the boundary: expires_at is exactly "now" as the row is written, which
        // is in the past by the time the request runs. `<=` is the contract: at the instant
        // of expiry the link is already dead, not alive for one more tick.
        var boundary = await MintAsync(admin.Client, reportId);
        await WithDbAsync(async db =>
        {
            var row = await db.ReportShares.FirstAsync(s => s.Id == boundary.Id);
            row.ExpiresAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        });

        var revoked = await MintAsync(admin.Client, reportId);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.Client.DeleteAsync($"/admin/reports/{reportId}/shares/{revoked.Id}")).StatusCode);

        var client = AnonymousClient();
        var reference = await ObservableShape(await client.GetAsync($"/shared/reports/{ReportShareTokens.NewToken()}"));
        Assert.StartsWith("404 ", reference, StringComparison.Ordinal);

        // Every one of these is a valid single path segment, so it reaches the handler, so it
        // MUST come back byte-for-byte identical to a never-minted token -- a different body,
        // header or status on any of them is a one-bit oracle an enumerator can read.
        var reachTheHandler = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["expired at the boundary"] = boundary.Token,
            ["revoked"] = revoked.Token,
            ["live token, case flipped"] = FlipCase(live.Token),
            ["live token, upper-cased"] = live.Token.ToUpperInvariant(),
            ["live token with a trailing space (encoded)"] = live.Token + "%20",
            ["live token with base64 padding"] = live.Token + "%3D",
            ["live token, one character short"] = live.Token[..^1],
            ["live token, one character extra"] = live.Token + "A",
            ["unicode"] = "caf%C3%A9-" + live.Token[..20],
            ["two kilobytes of the right alphabet"] = new string('A', 2048),
            ["the hash instead of the token"] = ReportShareTokens.Hash(live.Token),
        };

        var different = new List<string>();
        foreach (var (name, token) in reachTheHandler)
        {
            var shape = await ObservableShape(await client.GetAsync($"/shared/reports/{token}"));
            if (!string.Equals(shape, reference, StringComparison.Ordinal))
            {
                different.Add($"{name}: {shape}");
            }
        }

        Assert.True(different.Count == 0,
            "tokens the endpoint answered differently from a never-minted one:\n  " + string.Join("\n  ", different));

        // These cannot be a single path segment (a literal or encoded '/', a bare dot), so
        // routing may answer them before the handler. The guarantee they carry is weaker but
        // still real: never a 200, never a 5xx -- a token that cannot address the endpoint
        // certainly must not open a report. Each is built by INSERTING into the live token so
        // it is guaranteed distinct from it (a Replace-based variant would be a no-op, and
        // resolve, on the tokens that happen to contain no '-' or '_').
        foreach (var token in new[]
                 {
                     live.Token[..20] + "/" + live.Token[20..],    // a literal slash mid-token
                     live.Token[..10] + "%2F" + live.Token[10..],  // an encoded slash mid-token
                     ".",
                 })
        {
            var response = await client.GetAsync($"/shared/reports/{token}");
            Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.True((int)response.StatusCode < 500, $"a non-segment token gave {(int)response.StatusCode}");
        }

        // Nothing above counted as an access anywhere, and the live one still works.
        Assert.Equal(0, await SharedReadRowsAsync(_companyId));
        Assert.Equal(0, await AccessCountAsync(live.Id));
        Assert.Equal(0, await AccessCountAsync(boundary.Id));
        Assert.Equal(0, await AccessCountAsync(revoked.Id));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(live.Path)).StatusCode);
    }

    private static string FlipCase(string token)
    {
        var chars = token.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (char.IsLetter(chars[i]))
            {
                chars[i] = char.IsUpper(chars[i]) ? char.ToLowerInvariant(chars[i]) : char.ToUpperInvariant(chars[i]);
                return new string(chars);
            }
        }

        throw new InvalidOperationException("a 43-character Base64Url token with no letter in it is not a token this test can flip");
    }

    /// <summary>
    /// A share whose whole company is gone. <c>reports.company_id</c> cascades, and
    /// <c>report_shares.report_id</c> cascades after it, so the token becomes unknown; the
    /// attack would pass if either cascade were a SetNull leaving a share that joined to no
    /// report and threw, or a Restrict that left a live token pointing at a tenant that no
    /// longer exists.
    /// </summary>
    [Fact]
    public async Task A_share_for_a_report_whose_company_was_deleted_is_indistinguishable_from_a_dead_link()
    {
        var doomedCompanyId = await SeedCompanyAsync("Doomed Co");
        var superAdmin = await ActorAsync(superAdmin: true);
        var reportId = await CreateReportAsync(superAdmin.Client, doomedCompanyId, "Doomed");
        var share = await MintAsync(superAdmin.Client, reportId);
        Assert.Equal(HttpStatusCode.OK, (await AnonymousClient().GetAsync(share.Path)).StatusCode);

        await WithDbAsync(async db =>
        {
            // audit_logs.company_id is RESTRICT; the resolve above wrote one. Clear the
            // trail first so the deletion exercises the cascades this test is about.
            await db.AuditLogs.Where(a => a.CompanyId == doomedCompanyId).ExecuteDeleteAsync();
            await db.Companies.Where(c => c.Id == doomedCompanyId).ExecuteDeleteAsync();
        });

        var client = AnonymousClient();
        var dead = await ObservableShape(await client.GetAsync(share.Path));
        var unknown = await ObservableShape(await client.GetAsync($"/shared/reports/{ReportShareTokens.NewToken()}"));
        Assert.Equal(unknown, dead);
        Assert.StartsWith("404 ", dead, StringComparison.Ordinal);

        Assert.False(await WithDbAsync(db => db.ReportShares.AnyAsync(s => s.Id == share.Id)), "the share row outlived its company");
    }

    /// <summary>
    /// Only GET resolves. A HEAD that resolved would count an access and write an audit row for
    /// a request that returned no document; a POST or DELETE that did anything at all on an
    /// unauthenticated route would be a second, unreviewed public surface.
    /// </summary>
    [Fact]
    public async Task Only_GET_resolves_and_no_other_method_counts_an_access()
    {
        var admin = await ActorAsync();
        var reportId = await CreateReportAsync(admin.Client, _companyId);
        var share = await MintAsync(admin.Client, reportId);
        var client = AnonymousClient();

        foreach (var method in new[] { HttpMethod.Head, HttpMethod.Post, HttpMethod.Put, HttpMethod.Delete, HttpMethod.Patch, HttpMethod.Options })
        {
            var response = await client.SendAsync(new HttpRequestMessage(method, share.Path));
            Assert.True((int)response.StatusCode < 500, $"{method}: {(int)response.StatusCode}");
            Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.Empty(await response.Content.ReadAsStringAsync());
        }

        Assert.Equal(0, await AccessCountAsync(share.Id));
        Assert.Equal(0, await SharedReadRowsAsync(_companyId));
    }

    // ------------------------------------------------------------------
    // 5. What the document itself may carry to an anonymous reader
    // ------------------------------------------------------------------

    /// <summary>
    /// The attack the platform's hard rules exist for: a report generated over a survey that
    /// holds verbatim free text and a department below the anonymity floor, fetched with no
    /// session. If the document carried a respondent's words, or the small department's score,
    /// or the administrator who minted the link, this test's sentinels would find them.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Two surveys, so both floors are exercised: one above the survey floor with a department
    /// under the segment floor, and one below the survey floor altogether.
    /// </para>
    /// <para>
    /// <b>This test has found its bug once already and the fixture is built to keep finding
    /// it.</b> The sentinel is written by all three members of the sub-floor department and by
    /// nobody else, which is the case neither floor catches on its own: the segment floor of 5
    /// suppresses that department everywhere else in the same document but does not govern
    /// words, and the word floor of 2 counts distinct responses without knowing which segment
    /// they came from -- so three people in a suppressed team clear it. The word separators do
    /// not include <c>-</c>, so the sentinel survives tokenisation as one word and lands in the
    /// cloud intact. When the resolve handler returned <c>report_output</c> verbatim it
    /// published exactly that.
    /// </para>
    /// <para>
    /// The answer is that <c>PublicReportProjection</c> empties every word list on the public
    /// document, so the assertion below is not "the sentinel is absent" -- which one lucky
    /// tokenisation could satisfy -- but "no <c>words</c> array anywhere on this document has
    /// anything in it". A future change that re-admits word clouds to the anonymous route fails
    /// here whatever the words happen to be.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task The_public_document_carries_no_verbatim_text_no_sub_floor_score_and_no_minting_identity()
    {
        const string sentinel = "VERBATIM-SENTINEL-do-not-publish-9f10b441";
        var admin = await ActorAsync();
        var surveyAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var smallDept = await _harness.SeedDepartmentAsync(_companyId, "Tiny Team");
        var bigDept = await _harness.SeedDepartmentAsync(_companyId, "Large Team");

        var survey = await SurveyTestHarness.CreateSurveyAsync(surveyAdmin, SurveyTestHarness.MinimalRequest(
            _companyId,
            title: LocalizedInput.FromBare("Refutation Survey"),
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("How is leadership?"), QuestionTypes.Likert,
                    ScaleMin: 1, ScaleMax: 5, Order: 0, Category: "leadership"),
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("What would you change?"), QuestionTypes.OpenEnded, Order: 1),
            ]));
        Assert.Equal(HttpStatusCode.OK, (await SurveyTestHarness.SetStatusAsync(surveyAdmin, survey.Id, SurveyStatuses.Active)).StatusCode);

        var likertId = survey.Questions.Single(q => q.Type == QuestionTypes.Likert).Id;
        var openId = survey.Questions.Single(q => q.Type == QuestionTypes.OpenEnded).Id;

        // Three in the tiny department, all scoring 1 and all writing the sentinel; five in
        // the large one scoring 5. Eight in total, above the survey floor.
        for (var i = 0; i < 3; i++) await SeedResponseAsync(survey.Id, smallDept, likertId, "1", openId, sentinel);
        for (var i = 0; i < 5; i++) await SeedResponseAsync(survey.Id, bigDept, likertId, "5", openId, "fine as it is");

        // A second survey with two responses: below the survey floor entirely.
        var tiny = await SurveyTestHarness.CreateSurveyAsync(surveyAdmin, SurveyTestHarness.MinimalRequest(
            _companyId,
            title: LocalizedInput.FromBare("Two Respondents"),
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("How is pay?"), QuestionTypes.Likert,
                    ScaleMin: 1, ScaleMax: 5, Order: 0, Category: "compensation"),
            ]));
        Assert.Equal(HttpStatusCode.OK, (await SurveyTestHarness.SetStatusAsync(surveyAdmin, tiny.Id, SurveyStatuses.Active)).StatusCode);
        var payId = tiny.Questions.Single().Id;
        for (var i = 0; i < 2; i++) await SeedResponseAsync(tiny.Id, bigDept, payId, "2", null, null);

        var reportId = await CreateReportAsync(admin.Client, _companyId, "Refutation Report");
        var share = await MintAsync(admin.Client, reportId);

        var response = await AnonymousClient().GetAsync(share.Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();

        // Verbatim text: never, anywhere in the bytes.
        Assert.DoesNotContain(sentinel, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("fine as it is", raw, StringComparison.OrdinalIgnoreCase);

        // The minting administrator, the token, its hash, the tenant: none of them.
        Assert.DoesNotContain(admin.Email, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(admin.UserId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(share.Token, raw, StringComparison.Ordinal);
        Assert.DoesNotContain(ReportShareTokens.Hash(share.Token), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(share.Id.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(_companyId.ToString(), raw, StringComparison.OrdinalIgnoreCase);

        using var envelope = JsonDocument.Parse(raw);
        using var document = JsonDocument.Parse(envelope.RootElement.GetProperty("reportOutput").GetString()!);
        var surveys = document.RootElement.GetProperty("surveys").EnumerateArray().ToList();
        Assert.Equal(2, surveys.Count);

        var section = surveys.Single(s => s.GetProperty("title").GetString() == "Refutation Survey");
        Assert.False(section.GetProperty("isSuppressed").GetBoolean());
        var leadership = section.GetProperty("dimensions").EnumerateArray()
            .Single(d => d.GetProperty("dimension").GetString() == "leadership");
        Assert.Equal(8, leadership.GetProperty("answeredCount").GetInt32());

        // The tiny department: named (org data), but no score, no rate, no headcount.
        var departments = section.GetProperty("departments").EnumerateArray().ToList();
        var tinyTeam = departments.Single(d => d.GetProperty("name").GetString() == "Tiny Team");
        Assert.True(tinyTeam.GetProperty("isSuppressed").GetBoolean());
        Assert.Equal(0, tinyTeam.GetProperty("respondentCount").GetInt32());
        Assert.Equal(JsonValueKind.Null, tinyTeam.GetProperty("participationRate").ValueKind);
        Assert.Equal(1, section.GetProperty("suppressedDepartmentCount").GetInt32());

        var largeTeam = departments.Single(d => d.GetProperty("name").GetString() == "Large Team");
        Assert.False(largeTeam.GetProperty("isSuppressed").GetBoolean());
        Assert.Equal(5, largeTeam.GetProperty("respondentCount").GetInt32());

        // Respondent-WRITTEN content: never, in any shape. The word list is the only place in
        // this document a respondent's own characters could appear, so the assertion is on the
        // shape and not on the sentinel -- every `words` array on the public payload, at any
        // depth, is empty. Re-admit word clouds to the anonymous route and this fails loudly,
        // whatever the words are and whether or not they happen to contain a sentinel.
        var wordArrays = PropertyValues(document.RootElement, "words").ToList();
        Assert.NotEmpty(wordArrays); // the fixture really did produce open-text questions
        foreach (var words in wordArrays)
        {
            Assert.Equal(JsonValueKind.Array, words.ValueKind);
            Assert.Empty(words.EnumerateArray());
        }

        // And the reader is told they were withheld rather than left to read an empty list as
        // "nobody wrote anything" -- the platform's own rule, from SurveyResultsPrivacy: a
        // withheld count is always reported. The open question was answered by all eight.
        var openQuestion = section.GetProperty("questions").EnumerateArray()
            .Single(q => q.GetProperty("type").GetString() == QuestionTypes.OpenEnded);
        Assert.Equal(8, openQuestion.GetProperty("answeredCount").GetInt32());
        Assert.True(
            openQuestion.GetProperty("suppressedWordCount").GetInt32() > 0,
            "the public document says nothing was withheld from a question eight people wrote answers to");

        // The document still carries the aggregates it is published to carry -- a projection
        // that emptied everything would pass every assertion above and ship a blank page.
        Assert.NotEmpty(section.GetProperty("questions").EnumerateArray());
        var likert = section.GetProperty("questions").EnumerateArray()
            .Single(q => q.GetProperty("type").GetString() == QuestionTypes.Likert);
        Assert.NotEmpty(likert.GetProperty("distribution").EnumerateArray());

        // This list used to also forbid `questions`, `distribution`, `average`, `median` and
        // `text`, because when it was written the document had no per-question section at all
        // and "the projection dropped that level entirely" was the guarantee. #413 built the
        // level, and #414 built the public page that renders it, so forbidding those names now
        // would be a test defending a feature's absence. They are deliberately gone from this
        // list and the guarantee moved: per-question AGGREGATES are published (asserted a few
        // lines up, so their absence is a failure too), and the respondent-written half of the
        // same section is not (asserted above). What stays forbidden is the raw answer
        // storage and the identifiers, which no report document has ever been allowed to carry.
        var names = PropertyNames(document.RootElement).ToHashSet(StringComparer.Ordinal);
        foreach (var forbidden in new[] { "responseText", "responseValue", "email", "userId", "respondentId" })
        {
            Assert.False(names.Contains(forbidden), $"the public document carries a '{forbidden}' property");
        }

        // Only the department names and the "1"/"5" that appear as counts may show up; the
        // tiny team's average of 1.0 must not be anywhere as a score, under any key that
        // carries one.
        Assert.DoesNotContain("\"averageScore\":1", raw.Replace("\\\"", "\""), StringComparison.Ordinal);

        // The survey below the survey floor: still listed, participation counts only.
        var below = surveys.Single(s => s.GetProperty("title").GetString() == "Two Respondents");
        Assert.True(below.GetProperty("isSuppressed").GetBoolean());
        Assert.Empty(below.GetProperty("dimensions").EnumerateArray());
        Assert.Empty(below.GetProperty("departments").EnumerateArray());
        Assert.Equal(2, below.GetProperty("participation").GetProperty("completedCount").GetInt32());
    }

    /// <summary>
    /// The property this whole surface now rests on: <b>the public payload is an allow-list,
    /// so a key in the stored document that nobody named cannot reach an anonymous reader.</b>
    /// </summary>
    /// <remarks>
    /// <para>
    /// The tests above assert the fields we know about. This one asserts the shape of the
    /// guarantee, which is the part that survives the next person: the stored document is
    /// rewritten to carry three sections nobody allow-listed -- one of them a respondent's
    /// sentence, one of them a user id -- and the endpoint publishes none of them, while the
    /// sections that ARE on the list come through intact.
    /// </para>
    /// <para>
    /// Written against the database rather than the generator on purpose. The failure being
    /// refuted is not "the generator emits something new", it is "the public payload is
    /// whatever is in that column", which was literally true until
    /// <c>PublicReportProjection</c> existed. Writing the column directly is the shortest
    /// statement of that, and it is also how the next section will arrive: as a change to what
    /// gets stored, made by somebody who is not thinking about this endpoint.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task A_stored_section_nobody_allow_listed_does_not_reach_the_public_payload()
    {
        const string sentinel = "UNRULED-SECTION-SENTINEL-do-not-publish";
        var admin = await ActorAsync();
        var reportId = await CreateReportAsync(admin.Client, _companyId, "Fail Closed");
        var share = await MintAsync(admin.Client, reportId);

        // A document from some future generator: the four sections that have been ruled on,
        // plus three that have not -- at the top level and nested inside a section that is
        // itself admitted.
        await WithDbAsync(async db =>
        {
            var report = await db.Reports.FirstAsync(r => r.Id == reportId);
            report.ReportOutput = $$"""
                {
                  "generationNote": "still a note",
                  "surveys": [
                    {
                      "surveyId": "11111111-1111-1111-1111-111111111111",
                      "title": "Kept Survey",
                      "status": "closed",
                      "resolvedLocale": "en",
                      "questions": [],
                      "dimensions": [],
                      "departments": [],
                      "demographics": [],
                      "isSuppressed": false,
                      "minimumGroupSize": 5,
                      "verbatimResponses": ["{{sentinel}}"]
                    }
                  ],
                  "aiInsights": [],
                  "benchmarks": [],
                  "openTextAppendix": ["{{sentinel}}"],
                  "generatedBy": "{{admin.UserId}}"
                }
                """;
            await db.SaveChangesAsync();
        });

        var response = await AnonymousClient().GetAsync(share.Path);

        // The status code is not part of this: a document the projection narrows is still a
        // document, and this route answers 200 or the one 404 and nothing else, ever.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();

        using var envelope = JsonDocument.Parse(raw);
        using var document = JsonDocument.Parse(envelope.RootElement.GetProperty("reportOutput").GetString()!);

        // The allow-listed sections survived, so this is not passing by publishing nothing.
        Assert.Equal("still a note", document.RootElement.GetProperty("generationNote").GetString());
        Assert.Equal(
            "Kept Survey",
            document.RootElement.GetProperty("surveys").EnumerateArray().Single().GetProperty("title").GetString());

        // The three nobody named did not.
        var names = PropertyNames(document.RootElement).ToHashSet(StringComparer.Ordinal);
        Assert.DoesNotContain("openTextAppendix", names);
        Assert.DoesNotContain("generatedBy", names);
        Assert.DoesNotContain("verbatimResponses", names);
        Assert.DoesNotContain(sentinel, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(admin.UserId.ToString(), raw, StringComparison.OrdinalIgnoreCase);

        // The authenticated owner of the report still gets the column as stored -- the
        // narrowing is a property of the anonymous route, not of the report.
        var detail = await admin.Client.GetFromJsonAsync<ReportDetail>($"/admin/reports/{reportId}");
        Assert.Contains(sentinel, detail!.ReportOutput!, StringComparison.Ordinal);
        Assert.Contains("openTextAppendix", detail.ReportOutput!, StringComparison.Ordinal);
    }

    /// <summary>
    /// The public document is a tree of arrays of objects, so "no word list anywhere has
    /// anything in it" cannot be asked of the top level. Every value stored under
    /// <paramref name="name"/>, at any depth.
    /// </summary>
    private static IEnumerable<JsonElement> PropertyValues(JsonElement element, string name)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (string.Equals(property.Name, name, StringComparison.Ordinal))
                    {
                        yield return property.Value;
                    }

                    foreach (var nested in PropertyValues(property.Value, name)) yield return nested;
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var nested in PropertyValues(item, name)) yield return nested;
                }

                break;
        }
    }

    private static IEnumerable<string> PropertyNames(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    yield return property.Name;
                    foreach (var nested in PropertyNames(property.Value)) yield return nested;
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var nested in PropertyNames(item)) yield return nested;
                }
                break;
        }
    }

    private Task SeedResponseAsync(Guid surveyId, Guid departmentId, Guid likertId, string likertValue, Guid? openId, string? text)
        => WithDbAsync(async db =>
        {
            var responseId = Guid.NewGuid();
            db.Responses.Add(new Response
            {
                Id = responseId,
                SurveyId = surveyId,
                CompanyId = _companyId,
                UserId = null,
                DepartmentId = departmentId,
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
            db.QuestionResponses.Add(new QuestionResponse
            {
                ResponseId = responseId,
                QuestionId = likertId,
                ResponseValue = JsonSerializer.Serialize(likertValue),
                ResponseText = text,
            });
            if (openId is { } open)
            {
                db.QuestionResponses.Add(new QuestionResponse
                {
                    ResponseId = responseId,
                    QuestionId = open,
                    ResponseValue = JsonSerializer.Serialize(text),
                    ResponseText = null,
                });
            }

            await db.SaveChangesAsync();
        });

    // ------------------------------------------------------------------
    // 7. Revoke: race, and the trail
    // ------------------------------------------------------------------

    /// <summary>
    /// A revoke landing in the middle of a burst of resolves is not undone by any of them.
    /// The resolve is a read-modify-write on the same row with no concurrency token; if its
    /// UPDATE wrote every column rather than the changed ones, a resolve that had read the
    /// row before the revoke would write <c>revoked_at = NULL</c> back and resurrect the link.
    /// </summary>
    [Fact]
    public async Task A_revoke_survives_a_burst_of_overlapping_resolves()
    {
        var admin = await ActorAsync();
        var reportId = await CreateReportAsync(admin.Client, _companyId);
        var share = await MintAsync(admin.Client, reportId);
        var client = AnonymousClient();

        var burst = Enumerable.Range(0, 24).Select(_ => client.GetAsync(share.Path)).ToList();
        await Task.Delay(15);
        var revoke = admin.Client.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}");
        var responses = await Task.WhenAll(burst);
        Assert.Equal(HttpStatusCode.NoContent, (await revoke).StatusCode);

        // Every overlapping resolve answered one of the two legitimate verdicts, never a 500.
        Assert.All(responses, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.NotFound }));

        var stored = await WithDbAsync(db => db.ReportShares.AsNoTracking().FirstAsync(s => s.Id == share.Id));
        Assert.NotNull(stored.RevokedAt);
        Assert.Equal(admin.UserId, stored.RevokedBy);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(share.Path)).StatusCode);

        // The counter may under-count (documented), never over-count, and every OK left a row.
        var served = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        Assert.InRange(stored.AccessCount, 1, served);
        Assert.Equal(served, await SharedReadRowsAsync(_companyId));
    }

    /// <summary>
    /// The three authenticated routes leave rows that say which report, and never the token.
    /// The mint's row must name the report (it is the only id in its path); the revoke's must
    /// name the share and carry the report in its path, so "who revoked the link to report X"
    /// is answerable from the trail alone.
    /// </summary>
    [Fact]
    public async Task Mint_and_revoke_leave_audit_rows_that_name_the_report_and_never_the_token()
    {
        var admin = await ActorAsync();
        var reportId = await CreateReportAsync(admin.Client, _companyId);
        var share = await MintAsync(admin.Client, reportId);
        Assert.Equal(HttpStatusCode.OK, (await admin.Client.GetAsync($"/admin/reports/{reportId}/shares")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.Client.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}")).StatusCode);

        var rows = await WithDbAsync(db => db.AuditLogs.AsNoTracking()
            .Where(a => a.CompanyId == _companyId && a.UserId == admin.UserId)
            .OrderBy(a => a.Timestamp)
            .ToListAsync());

        var mint = Assert.Single(rows, r => r.Resource == "admin.reports.share");
        Assert.Equal(reportId.ToString(), mint.ResourceId);
        Assert.True(mint.Success);
        Assert.Contains($"/admin/reports/{reportId}/share", mint.Details!, StringComparison.Ordinal);

        var revoke = Assert.Single(rows, r => r.Resource == "admin.reports.shares");
        Assert.Equal(share.Id.ToString(), revoke.ResourceId);
        Assert.Contains($"/admin/reports/{reportId}/shares/{share.Id}", revoke.Details!, StringComparison.Ordinal);

        // The list is a metadata read and is not audited; a row for it would be noise.
        Assert.DoesNotContain(rows, r => r.Details is not null && r.Details.Contains($"/admin/reports/{reportId}/shares\"", StringComparison.Ordinal));

        // No row anywhere in the trail holds the credential or its hash. Materialised first:
        // audit_logs.details is a jsonb column, and EF cannot translate a substring match on
        // jsonb -- the check is what matters, so it runs in memory over the fetched rows.
        var allDetails = await WithDbAsync(db => db.AuditLogs.AsNoTracking()
            .Where(a => a.CompanyId == _companyId && a.Details != null)
            .Select(a => a.Details!)
            .ToListAsync());
        Assert.DoesNotContain(allDetails, d => d.Contains(share.Token, StringComparison.Ordinal));
        Assert.DoesNotContain(allDetails, d => d.Contains(ReportShareTokens.Hash(share.Token), StringComparison.OrdinalIgnoreCase));
    }

    // ------------------------------------------------------------------
    // 6. Enumeration cost
    // ------------------------------------------------------------------

    /// <summary>
    /// The public route is rate limited per caller, and the limit fires -- asserted by firing
    /// it rather than by reading the metadata. A second caller is untouched, and the 429 is
    /// shaped like nothing the token could have influenced.
    /// </summary>
    [Fact]
    public async Task An_enumerating_caller_is_refused_after_the_public_link_budget_and_nobody_else_is()
    {
        var flooder = AnonymousClient();
        var bystander = AnonymousClient();
        var admin = await ActorAsync();
        var share = await MintAsync(admin.Client, await CreateReportAsync(admin.Client, _companyId));

        HttpResponseMessage? refused = null;
        for (var i = 0; i < Api.Infrastructure.RateLimitPolicies.PublicLinkPermitsPerWindow + 5; i++)
        {
            var response = await flooder.GetAsync($"/shared/reports/{ReportShareTokens.NewToken()}");
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                refused = response;
                break;
            }

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        Assert.NotNull(refused);
        Assert.DoesNotContain("report", await refused!.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        // Once refused, even the live token is refused for this caller -- the limiter decides
        // before the token is looked at, so a flood cannot be told apart by what it guessed.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await flooder.GetAsync(share.Path)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await bystander.GetAsync(share.Path)).StatusCode);
    }

    // ------------------------------------------------------------------
    // 9. The wire, byte for byte, as sharedReports.ts reads it
    // ------------------------------------------------------------------

    /// <summary>
    /// <c>sharedReports.ts</c> reads five camelCase properties and treats <c>reportOutput</c>
    /// as a JSON <em>string</em> to be parsed a second time; <c>reportDocument.ts</c> then
    /// reads <c>generationNote</c>, <c>surveys</c> and <c>aiInsights</c> from it. Asserted on
    /// the raw bytes: a deserialised DTO would accept a PascalCase wire without complaint.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>This list is the public allow-list, restated from the client's side, and every
    /// entry on it is a decision.</b> It is not a description of what the generator happens to
    /// write: <c>PublicReportProjection</c> decides what an anonymous reader gets, and this
    /// test is where that decision is visible to somebody reading the tests rather than the
    /// projection. A new section reaching the public document makes this test red, which is
    /// the intended cost of publishing one.
    /// </para>
    /// <para>
    /// <c>benchmarks</c> is here <b>deliberately</b>, and was argued rather than inherited.
    /// #413 added it to the stored document, at which point the old verbatim handler published
    /// it with nobody deciding and this test caught that. The ruling: a benchmark comparison is
    /// anonymised cohort data -- the company's own readings against its own prior period, plus
    /// the global rows every tenant compares against -- carrying no respondent, no verbatim
    /// text and no segment below a floor, and the public page
    /// (<c>SharedReportSections.tsx</c>) exists to render exactly that. So it is admitted, on
    /// purpose, and this line is the record of it.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task The_wire_shape_is_exactly_what_the_shipped_client_parses()
    {
        var admin = await ActorAsync();
        var share = await MintAsync(admin.Client, await CreateReportAsync(admin.Client, _companyId, "Wire Check"));

        var response = await AnonymousClient().GetAsync(share.Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var raw = await response.Content.ReadAsStringAsync();

        using var envelope = JsonDocument.Parse(raw);
        var root = envelope.RootElement;
        Assert.Equal(JsonValueKind.Object, root.ValueKind);
        Assert.Equal(
            new[] { "description", "generatedAt", "reportOutput", "title", "type" },
            root.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());

        Assert.Equal(JsonValueKind.String, root.GetProperty("title").ValueKind);
        Assert.Equal("Wire Check", root.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.String, root.GetProperty("description").ValueKind);
        Assert.Equal(JsonValueKind.String, root.GetProperty("type").ValueKind);
        Assert.Equal("climate_summary", root.GetProperty("type").GetString());

        // An ISO-8601 instant the browser's Date can parse, not a .NET-only format.
        Assert.Equal(JsonValueKind.String, root.GetProperty("generatedAt").ValueKind);
        Assert.True(DateTimeOffset.TryParseExact(
            root.GetProperty("generatedAt").GetString(),
            "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK",
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None,
            out _), $"generatedAt is not ISO-8601: {root.GetProperty("generatedAt").GetString()}");

        // reportOutput is a string on the wire -- the client does `typeof === 'string'` and
        // parses it itself. An object here would make every shared page render empty.
        var output = root.GetProperty("reportOutput");
        Assert.Equal(JsonValueKind.String, output.ValueKind);
        using var document = JsonDocument.Parse(output.GetString()!);
        Assert.Equal(
            new[] { "aiInsights", "benchmarks", "generationNote", "surveys" },
            document.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(JsonValueKind.Array, document.RootElement.GetProperty("surveys").ValueKind);
        Assert.Equal(JsonValueKind.Array, document.RootElement.GetProperty("aiInsights").ValueKind);
        Assert.Equal(JsonValueKind.Array, document.RootElement.GetProperty("benchmarks").ValueKind);
    }
}
