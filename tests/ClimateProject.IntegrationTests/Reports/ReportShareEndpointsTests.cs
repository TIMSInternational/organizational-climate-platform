using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

/// <summary>
/// #139: minting a report share link, and resolving one with no session.
/// </summary>
[Collection("Postgres")]
public class ReportShareEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"shr-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportShareEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(new Company
        {
            Id = _companyId = Guid.NewGuid(),
            Name = "Share Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private async Task<HttpClient> AdminClientAsync(string role = Roles.CompanyAdmin, Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Share Admin", email, "a-good-password"));

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = companyId ?? _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>Creates a completed report through the real endpoint and returns its id.</summary>
    private static async Task<Guid> CreateReportAsync(HttpClient admin, Guid companyId, string title = "Q3 Climate Report")
    {
        var response = await admin.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            title, "Quarterly summary", "climate_summary", companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReportDetail>())!.Id;
    }

    private static async Task<CreateReportShareResponse> MintAsync(HttpClient admin, Guid reportId, int? days = null)
    {
        var response = await admin.PostAsJsonAsync($"/admin/reports/{reportId}/share", new CreateReportShareRequest(days));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreateReportShareResponse>())!;
    }

    /// <summary>A client with no Authorization header at all -- the share link's real caller.</summary>
    private HttpClient AnonymousClient() => _factory.CreateClient();

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> work)
    {
        using var scope = _factory.Services.CreateScope();
        await work(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    // ------------------------------------------------------------------
    // AC1: a valid link renders without authentication
    // ------------------------------------------------------------------

    /// <summary>
    /// AC1. The whole point of the feature: a caller with no account, no token and no cookie
    /// gets the report's document.
    /// </summary>
    /// <remarks>
    /// Asserts the document's own contents survive the round trip, not merely a 200 -- a page
    /// that renders an empty shell to an unauthenticated visitor would pass a status-code-only
    /// test while delivering nothing.
    /// </remarks>
    [Fact]
    public async Task A_valid_share_link_resolves_for_a_caller_with_no_session()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId, "Clima Organizacional Q3");
        var share = await MintAsync(admin, reportId);

        var response = await AnonymousClient().GetAsync($"/shared/reports/{share.Token}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SharedReportResponse>();
        Assert.Equal("Clima Organizacional Q3", body!.Title);
        Assert.Equal("Quarterly summary", body.Description);
        Assert.Equal("climate_summary", body.Type);
        Assert.NotNull(body.GeneratedAt);

        // The generated document itself, carried through verbatim rather than recomputed.
        Assert.NotNull(body.ReportOutput);
        using var document = JsonDocument.Parse(body.ReportOutput!);
        Assert.True(document.RootElement.ValueKind == JsonValueKind.Object);
    }

    /// <summary>
    /// The path the mint hands back is the one that works, not a string assembled by hope.
    /// </summary>
    [Fact]
    public async Task The_path_returned_by_the_mint_is_the_path_that_resolves()
    {
        var admin = await AdminClientAsync();
        var share = await MintAsync(admin, await CreateReportAsync(admin, _companyId));

        Assert.Equal($"/shared/reports/{share.Token}", share.Path);
        Assert.Equal(HttpStatusCode.OK, (await AnonymousClient().GetAsync(share.Path)).StatusCode);
    }

    // ------------------------------------------------------------------
    // AC2: expired, revoked and invalid are indistinguishable
    // ------------------------------------------------------------------

    /// <summary>
    /// AC2, the criterion this endpoint mostly exists to keep: a dead token and a token that
    /// was never real must be the same event as far as the caller can measure.
    /// </summary>
    /// <remarks>
    /// Compares everything a caller can actually see -- status line, response body byte for
    /// byte, and the headers this endpoint sets -- across five causes, rather than asserting
    /// "each one is 404". Four separate 404s with four different bodies would pass the weaker
    /// test and enumerate perfectly.
    ///
    /// The <c>Date</c> header and the like are excluded because they vary between any two
    /// requests, including two identical ones; <see cref="ObservableShape"/> names what is
    /// compared.
    /// </remarks>
    [Fact]
    public async Task Expired_revoked_invalid_and_foreign_tokens_are_indistinguishable()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);

        var revoked = await MintAsync(admin, reportId);
        await admin.DeleteAsync($"/admin/reports/{reportId}/shares/{revoked.Id}");

        var expired = await MintAsync(admin, reportId);
        await WithDbAsync(async db =>
        {
            var hash = ReportShareTokens.Hash(expired.Token);
            var row = await db.ReportShares.FirstAsync(s => s.TokenHash == hash);
            row.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });

        // A link whose report has since been deleted: the row cascades away, so the token
        // becomes unknown rather than "known but orphaned".
        var deleted = await MintAsync(admin, await CreateReportAsync(admin, _companyId, "Doomed"));
        await WithDbAsync(async db =>
        {
            await db.Reports.Where(r => r.Title == "Doomed").ExecuteDeleteAsync();
        });

        var client = AnonymousClient();
        var cases = new Dictionary<string, string>
        {
            ["revoked"] = revoked.Token,
            ["expired"] = expired.Token,
            ["report deleted"] = deleted.Token,
            // Never minted, but shaped exactly like a real one.
            ["never minted"] = ReportShareTokens.NewToken(),
            // Not even the right shape. Must not be rejected sooner or differently.
            ["malformed"] = "not-a-token",
        };

        var shapes = new Dictionary<string, string>();
        foreach (var (name, token) in cases)
        {
            shapes[name] = await ObservableShape(await client.GetAsync($"/shared/reports/{token}"));
        }

        var distinct = shapes.Values.Distinct(StringComparer.Ordinal).ToList();
        Assert.True(
            distinct.Count == 1,
            "share-link failures are distinguishable:\n" +
            string.Join("\n", shapes.Select(kv => $"  {kv.Key}: {kv.Value}")));

        // And the one shape they share is a 404 that says nothing, not a 410 (which literally
        // means "this existed and is gone") and not a 403.
        Assert.StartsWith("404 ", distinct[0], StringComparison.Ordinal);
        Assert.DoesNotContain("revok", distinct[0], StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("expir", distinct[0], StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Everything about a response that a caller can compare between two requests: the status
    /// code, the body, and the headers this endpoint controls.
    /// </summary>
    private static async Task<string> ObservableShape(HttpResponseMessage response)
    {
        string Header(string name) =>
            response.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : "(absent)";

        var contentType = response.Content.Headers.ContentType?.ToString() ?? "(absent)";
        var body = await response.Content.ReadAsStringAsync();

        return $"{(int)response.StatusCode} {response.ReasonPhrase} | ct={contentType} | " +
               $"robots={Header("X-Robots-Tag")} | cache={Header("Cache-Control")} | " +
               $"pragma={Header("Pragma")} | body={body}";
    }

    /// <summary>
    /// Every resolve costs the same database round trip, whatever the token looks like.
    /// </summary>
    /// <remarks>
    /// <see cref="Expired_revoked_invalid_and_foreign_tokens_are_indistinguishable"/> compares
    /// what comes back. A short-circuit that rejected an obviously-malformed token before the
    /// lookup -- <c>if (token.Length != 43) return NotAvailable(...)</c> -- would return
    /// byte-identical bytes, so that test cannot see one. What it changes is the work: the
    /// request returns without the unique-index probe, and a database round trip is the term
    /// that dominates anything an attacker can time. That makes "malformed" measurably cheaper
    /// than "real but dead", which is the same disclosure as a different status code, only
    /// harder to notice.
    ///
    /// So this counts the commands the request actually sends -- the property the comment above
    /// the hash in <c>ResolveAsync</c> states, one SHA-256 and one unique-index probe for every
    /// input -- rather than a wall clock, which on a shared CI box measures the box.
    /// </remarks>
    [Fact]
    public async Task Every_resolve_costs_the_same_database_probe_whatever_the_token_looks_like()
    {
        var client = AnonymousClient();

        // The first request through the route pays for host warm-up and a connection, neither
        // of which is what is being measured.
        await client.GetAsync($"/shared/reports/{ReportShareTokens.NewToken()}");

        async Task<int> ProbeCostAsync(string token)
        {
            _factory.CommandCounter.Reset();
            var response = await client.GetAsync($"/shared/reports/{token}");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            return _factory.CommandCounter.Count;
        }

        var wellFormed = await ProbeCostAsync(ReportShareTokens.NewToken());
        var costs = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["well-formed but never minted"] = wellFormed,
            ["wrong charset, far too short"] = await ProbeCostAsync("not-a-token"),
            ["one character"] = await ProbeCostAsync("a"),
            ["far too long"] = await ProbeCostAsync(new string('a', 400)),
            ["digits only"] = await ProbeCostAsync("00000000"),
        };

        // One probe, not zero and not two: the resolve is a single unique-index lookup, and a
        // rejected token writes nothing.
        Assert.Equal(1, wellFormed);

        Assert.True(
            costs.Values.Distinct().Count() == 1,
            "a resolve short-circuits on the token's shape, so some tokens are measurably "
            + "cheaper to reject than others:\n"
            + string.Join("\n", costs.Select(kv => $"  {kv.Key}: {kv.Value} database command(s)")));
    }

    /// <summary>
    /// A report that is still generating, or that failed, is not published to link holders --
    /// and is not distinguishable from a dead link either.
    /// </summary>
    [Fact]
    public async Task A_report_that_is_not_completed_is_not_served_and_looks_like_a_dead_link()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var share = await MintAsync(admin, reportId);

        await WithDbAsync(async db =>
        {
            var report = await db.Reports.FirstAsync(r => r.Id == reportId);
            report.Status = "failed";
            await db.SaveChangesAsync();
        });

        var client = AnonymousClient();
        var failed = await ObservableShape(await client.GetAsync($"/shared/reports/{share.Token}"));
        var unknown = await ObservableShape(await client.GetAsync($"/shared/reports/{ReportShareTokens.NewToken()}"));

        Assert.Equal(unknown, failed);
    }

    /// <summary>
    /// A report with its own expiry takes its links with it: a link cannot outlive the thing
    /// it points at.
    /// </summary>
    [Fact]
    public async Task A_link_to_an_expired_report_stops_resolving()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var share = await MintAsync(admin, reportId, days: 365);

        Assert.Equal(HttpStatusCode.OK, (await AnonymousClient().GetAsync(share.Path)).StatusCode);

        await WithDbAsync(async db =>
        {
            var report = await db.Reports.FirstAsync(r => r.Id == reportId);
            report.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.NotFound, (await AnonymousClient().GetAsync(share.Path)).StatusCode);
    }

    // ------------------------------------------------------------------
    // AC3: nothing authenticated or cross-referencing leaks into the payload
    // ------------------------------------------------------------------

    /// <summary>
    /// AC3. The public payload is a document, not the record that produced it.
    /// </summary>
    /// <remarks>
    /// Asserts on the JSON the caller receives rather than on the DTO's shape, because the DTO
    /// is exactly what a careless <c>Results.Ok(report)</c> would replace. <c>companyId</c> and
    /// <c>createdBy</c> are the two that matter most: they are what would let a link holder
    /// join this document to another tenant surface.
    /// </remarks>
    [Fact]
    public async Task The_public_payload_carries_no_tenant_or_actor_identifiers()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var share = await MintAsync(admin, reportId);

        var response = await AnonymousClient().GetAsync(share.Path);
        var raw = await response.Content.ReadAsStringAsync();

        using var json = JsonDocument.Parse(raw);
        var properties = json.RootElement.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToList();
        Assert.Equal(
            new[] { "description", "generatedAt", "reportOutput", "title", "type" },
            properties);

        // Belt and braces against the identifiers appearing anywhere at all, including nested
        // inside the generated document.
        Assert.DoesNotContain(_companyId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(reportId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------
    // AC4: noindex
    // ------------------------------------------------------------------

    /// <summary>
    /// AC4, the API's half. A crawler that reaches this JSON directly never renders the SPA and
    /// never sees the page's meta tag; the header is the only instruction it gets. Asserted on
    /// both outcomes because a header present on one and absent on the other is itself a
    /// one-bit oracle.
    /// </summary>
    [Fact]
    public async Task Both_outcomes_tell_crawlers_not_to_index_and_caches_not_to_store()
    {
        var admin = await AdminClientAsync();
        var share = await MintAsync(admin, await CreateReportAsync(admin, _companyId));

        var client = AnonymousClient();
        foreach (var path in new[] { share.Path, $"/shared/reports/{ReportShareTokens.NewToken()}" })
        {
            var response = await client.GetAsync(path);
            Assert.True(response.Headers.TryGetValues("X-Robots-Tag", out var robots), $"no X-Robots-Tag on {path}");
            Assert.Contains("noindex", string.Join(",", robots!), StringComparison.OrdinalIgnoreCase);
            Assert.True(response.Headers.CacheControl!.NoStore, $"response for {path} may be stored");
        }
    }

    // ------------------------------------------------------------------
    // AC5: access is logged
    // ------------------------------------------------------------------

    /// <summary>
    /// AC5. A successful resolve leaves a row in the company's own audit trail and bumps the
    /// link's counter.
    /// </summary>
    /// <remarks>
    /// Asserts the row's tenant, its action, the resource id it points at and the share it came
    /// through -- not merely that a row exists. A row filed under the wrong company answers
    /// nobody's "who read this report", and a row that does not name the share cannot answer
    /// "who used the link we revoked".
    /// </remarks>
    [Fact]
    public async Task A_successful_resolve_writes_an_audit_row_and_counts_the_access()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var share = await MintAsync(admin, reportId);

        var client = AnonymousClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(share.Path)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(share.Path)).StatusCode);

        await WithDbAsync(async db =>
        {
            var rows = await db.AuditLogs
                .Where(a => a.CompanyId == _companyId && a.Resource == "shared.reports")
                .OrderBy(a => a.Timestamp)
                .ToListAsync();

            Assert.Equal(2, rows.Count);
            foreach (var row in rows)
            {
                Assert.Equal("shared.reports.read", row.Action);
                Assert.Equal(reportId.ToString(), row.ResourceId);
                Assert.True(row.Success);
                // The reader is a link holder, not an account. Null is the honest answer.
                Assert.Null(row.UserId);
                Assert.NotNull(row.Details);
                Assert.Contains(share.Id.ToString(), row.Details!, StringComparison.OrdinalIgnoreCase);
                // Never the credential itself.
                Assert.DoesNotContain(share.Token, row.Details!, StringComparison.Ordinal);
            }

            var stored = await db.ReportShares.FirstAsync(s => s.Id == share.Id);
            Assert.Equal(2, stored.AccessCount);
            Assert.NotNull(stored.LastAccessedAt);
        });
    }

    /// <summary>
    /// A rejected resolve is not counted as an access. The counter is "how many times this link
    /// served the report", and a probe that served nothing must not inflate it.
    /// </summary>
    [Fact]
    public async Task A_rejected_resolve_writes_no_audit_row_and_counts_nothing()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var share = await MintAsync(admin, reportId);
        await admin.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}");

        Assert.Equal(HttpStatusCode.NotFound, (await AnonymousClient().GetAsync(share.Path)).StatusCode);

        await WithDbAsync(async db =>
        {
            Assert.Empty(await db.AuditLogs
                .Where(a => a.CompanyId == _companyId && a.Resource == "shared.reports")
                .ToListAsync());
            Assert.Equal(0, (await db.ReportShares.FirstAsync(s => s.Id == share.Id)).AccessCount);
        });
    }

    // ------------------------------------------------------------------
    // The token is a credential
    // ------------------------------------------------------------------

    /// <summary>
    /// The token is never stored, only its hash -- so a database dump yields no working links.
    /// </summary>
    [Fact]
    public async Task The_token_is_stored_only_as_a_hash_and_is_never_readable_again()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var share = await MintAsync(admin, reportId);

        await WithDbAsync(async db =>
        {
            var row = await db.ReportShares.FirstAsync(s => s.Id == share.Id);
            Assert.NotEqual(share.Token, row.TokenHash);
            Assert.Equal(ReportShareTokens.TokenHashLength, row.TokenHash.Length);
            Assert.Equal(ReportShareTokens.Hash(share.Token), row.TokenHash);
            // Nothing in the row holds the token, under any column.
            Assert.False(await db.ReportShares.AnyAsync(s => s.TokenHash == share.Token));
        });

        // Nor does the administrator surface hand it back.
        var listed = await admin.GetAsync($"/admin/reports/{reportId}/shares");
        var raw = await listed.Content.ReadAsStringAsync();
        Assert.DoesNotContain(share.Token, raw, StringComparison.Ordinal);
        Assert.DoesNotContain(ReportShareTokens.Hash(share.Token), raw, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Two mints never produce the same token.</summary>
    [Fact]
    public async Task Every_mint_produces_a_distinct_token()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);

        var tokens = new List<string>();
        for (var i = 0; i < 5; i++) tokens.Add((await MintAsync(admin, reportId)).Token);

        Assert.Equal(5, tokens.Distinct(StringComparer.Ordinal).Count());
    }

    // ------------------------------------------------------------------
    // Who may mint, list and revoke
    // ------------------------------------------------------------------

    /// <summary>
    /// Minting a public link to another company's report is the worst thing this feature could
    /// allow, so the mint is scoped exactly as the report endpoints are.
    /// </summary>
    [Fact]
    public async Task An_admin_of_another_company_cannot_mint_list_or_revoke()
    {
        var owner = await AdminClientAsync();
        var reportId = await CreateReportAsync(owner, _companyId);
        var share = await MintAsync(owner, reportId);

        var otherCompanyId = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            db.Companies.Add(new Company
            {
                Id = otherCompanyId,
                Name = "Other Co",
                EmailDomain = $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        var stranger = await AdminClientAsync(Roles.CompanyAdmin, otherCompanyId);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await stranger.PostAsJsonAsync($"/admin/reports/{reportId}/share", new CreateReportShareRequest(null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync($"/admin/reports/{reportId}/shares")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await stranger.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}")).StatusCode);

        // And the link the stranger could not revoke still works for its holder.
        Assert.Equal(HttpStatusCode.OK, (await AnonymousClient().GetAsync(share.Path)).StatusCode);
    }

    /// <summary>
    /// An ordinary employee of the owning company cannot mint, list or revoke a public link.
    /// </summary>
    /// <remarks>
    /// The three admin routes are mapped on a group with <c>RequireAuthorization()</c> and no
    /// role policy, so the role clause in <c>CanAccessCompany</c> --
    /// <c>currentUser.Role == Roles.CompanyAdmin &amp;&amp;</c> -- is the entire barrier between
    /// any authenticated employee and an unauthenticated, year-long link to the company's
    /// climate report. Nothing else in this file varies the role:
    /// <see cref="An_admin_of_another_company_cannot_mint_list_or_revoke"/> varies the
    /// <em>company</em> across all three routes and would stay green with that clause deleted.
    ///
    /// Outcomes, not only status codes: after the refused mint the report still has exactly the
    /// one link its administrator made, and after the refused revoke that link still resolves.
    /// A handler that wrote the row and then answered 403 would pass a status-only test.
    /// </remarks>
    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    public async Task A_non_administrator_of_the_owning_company_cannot_mint_list_or_revoke(string role)
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var share = await MintAsync(admin, reportId);

        // Same company, same report, same session mechanics. Only the role differs.
        var insider = await AdminClientAsync(role);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await insider.PostAsJsonAsync($"/admin/reports/{reportId}/share", new CreateReportShareRequest(null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await insider.GetAsync($"/admin/reports/{reportId}/shares")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await insider.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}")).StatusCode);

        var summaries = await admin.GetFromJsonAsync<List<ReportShareSummary>>($"/admin/reports/{reportId}/shares");
        Assert.Equal(share.Id, Assert.Single(summaries!).Id);
        Assert.Null(Assert.Single(summaries!).RevokedAt);
        Assert.Equal(HttpStatusCode.OK, (await AnonymousClient().GetAsync(share.Path)).StatusCode);
    }

    /// <summary>The mint endpoint itself is not reachable without a session.</summary>
    [Fact]
    public async Task Minting_requires_a_session_even_though_resolving_does_not()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);

        var response = await AnonymousClient()
            .PostAsJsonAsync($"/admin/reports/{reportId}/share", new CreateReportShareRequest(null));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Revoking is idempotent, and a share id from one report cannot be revoked through
    /// another.
    /// </summary>
    [Fact]
    public async Task Revoking_is_idempotent_and_scoped_to_the_report_in_the_path()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var otherReportId = await CreateReportAsync(admin, _companyId, "Another report");
        var share = await MintAsync(admin, reportId);

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await admin.DeleteAsync($"/admin/reports/{otherReportId}/shares/{share.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AnonymousClient().GetAsync(share.Path)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AnonymousClient().GetAsync(share.Path)).StatusCode);
    }

    /// <summary>
    /// The listing is what makes revocation usable after the page reloads: it names every link,
    /// says which still resolve, and never repeats the secret.
    /// </summary>
    [Fact]
    public async Task The_listing_reports_which_links_are_still_live()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var live = await MintAsync(admin, reportId);
        var revoked = await MintAsync(admin, reportId);
        await admin.DeleteAsync($"/admin/reports/{reportId}/shares/{revoked.Id}");
        await AnonymousClient().GetAsync(live.Path);

        var summaries = await admin.GetFromJsonAsync<List<ReportShareSummary>>($"/admin/reports/{reportId}/shares");

        Assert.Equal(2, summaries!.Count);
        var liveRow = summaries.Single(s => s.Id == live.Id);
        Assert.True(liveRow.IsActive);
        Assert.Null(liveRow.RevokedAt);
        Assert.Equal(1, liveRow.AccessCount);
        Assert.NotNull(liveRow.LastAccessedAt);

        var revokedRow = summaries.Single(s => s.Id == revoked.Id);
        Assert.False(revokedRow.IsActive);
        Assert.NotNull(revokedRow.RevokedAt);
    }

    /// <summary>
    /// A lifetime is always finite, and an absurd request is clamped rather than honoured.
    /// </summary>
    [Fact]
    public async Task A_links_lifetime_is_always_finite_and_bounded()
    {
        var admin = await AdminClientAsync();
        var reportId = await CreateReportAsync(admin, _companyId);
        var before = DateTimeOffset.UtcNow;

        var defaulted = await MintAsync(admin, reportId, days: null);
        var absurd = await MintAsync(admin, reportId, days: 100_000);
        var negative = await MintAsync(admin, reportId, days: -5);

        Assert.InRange(
            defaulted.ExpiresAt,
            before.AddDays(ReportShareTokens.DefaultLifetimeDays).AddMinutes(-5),
            DateTimeOffset.UtcNow.AddDays(ReportShareTokens.DefaultLifetimeDays).AddMinutes(5));
        Assert.True(absurd.ExpiresAt <= DateTimeOffset.UtcNow.AddDays(ReportShareTokens.MaxLifetimeDays).AddMinutes(5));
        Assert.True(negative.ExpiresAt > DateTimeOffset.UtcNow);
    }
}
