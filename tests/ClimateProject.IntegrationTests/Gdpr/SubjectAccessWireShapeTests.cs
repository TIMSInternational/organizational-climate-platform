using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Gdpr;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Gdpr;

/// <summary>
/// The exact JSON <c>GET /gdpr/access</c> puts on the wire, asserted for the benefit of the
/// self-service privacy page (#137) that parses it.
///
/// <para><b>Why this is a separate class from <see cref="GdprEndpointsTests"/>.</b> That class
/// asserts what the export <i>contains</i> — the right rows, from the right tenant, with
/// credentials redacted. This one asserts the shape those contents arrive in, which is a
/// different contract with a different consumer: <c>web/src/features/profile/api/gdpr.ts</c>.
/// Nothing else in the repository connects the two. The TypeScript is compiled by another
/// toolchain, tested by another runner, and its own tests build their fixtures by hand — so a
/// change on this side that the page cannot read produces two green suites and a broken
/// screen.</para>
///
/// <para><b>The one that would actually happen.</b> <c>ClimateProject.Api</c> registers no
/// <c>JsonStringEnumConverter</c> — there is no <c>ConfigureHttpJsonOptions</c> call anywhere
/// and no <c>[JsonConverter]</c> on <see cref="SubjectLink"/> or
/// <see cref="ExportTreatment"/> — so <c>System.Text.Json</c> writes both as their underlying
/// integers, and the declaration order in <c>Application/Gdpr/SubjectDataMap.cs</c> is
/// load-bearing all the way to a table cell in a browser. Add the converter for some unrelated
/// endpoint, or insert an enum member above an existing one, and the privacy page starts
/// labelling a person's own data with the wrong category, or with a bare number. Neither
/// failure throws. This class is the alarm.</para>
///
/// <para>Every literal below is duplicated deliberately rather than read from the enum: an
/// assertion written as <c>(int)SubjectLink.Actor</c> would follow a renumbering rather than
/// catch it, and the numbers are pinned here because the page has them hard-coded in
/// <c>SUBJECT_LINK</c> and <c>EXPORT_TREATMENT</c>.</para>
/// </summary>
[Collection("Postgres")]
public class SubjectAccessWireShapeTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"gdpr-wire-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public SubjectAccessWireShapeTests(PostgresContainerFixture postgres)
    {
        _postgres = postgres;
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        await using var db = NewContext();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "GDPR Wire Co",
            EmailDomain = _domain,
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        _companyId = company.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private ClimateProjectDbContext NewContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(_postgres.ConnectionString)
            .Options);

    private async Task<(HttpClient Client, Guid UserId, string Email)> SignInAsync(string role)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Wire Shape", email, "a-good-password"));

        Guid userId;
        await using (var db = NewContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (client, userId, email);
    }

    private async Task<JsonElement> MyExportAsync(HttpClient client)
    {
        // No query string at all. That is the call the page makes, and the handler's
        // "omitting userId means 'about me'" branch is the whole of #137's server surface.
        var response = await client.GetAsync("/gdpr/access");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>
    /// #137's first acceptance criterion is "reachable by every role", and the page is linked
    /// from the account menu for all of them. The route it calls has no role gate by design —
    /// this pins that, for every role the product defines, including the two that
    /// <c>/gdpr/erasure</c> and <c>/gdpr/retention-cleanup</c> refuse.
    /// </summary>
    [Theory]
    [InlineData(Roles.SuperAdmin)]
    [InlineData(Roles.CompanyAdmin)]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task Any_role_can_ask_what_is_held_about_itself(string role)
    {
        var (client, userId, email) = await SignInAsync(role);

        var export = await MyExportAsync(client);

        var subject = export.GetProperty("subject");
        Assert.Equal(userId, subject.GetProperty("userId").GetGuid());
        Assert.Equal(email, subject.GetProperty("email").GetString());
    }

    /// <summary>
    /// The top-level keys, in the casing the page destructures them by. Minimal APIs use
    /// <c>JsonSerializerDefaults.Web</c>, so record properties are camelCased — but that is a
    /// default, and a default is a thing somebody changes.
    /// </summary>
    [Fact]
    public async Task The_envelope_keys_are_camel_case()
    {
        var (client, _, _) = await SignInAsync(Roles.Employee);

        var export = await MyExportAsync(client);

        Assert.Equal(
            ["complete", "generatedAt", "limitations", "sections", "sources", "subject"],
            export.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));

        Assert.Equal(
            ["email", "name", "userId"],
            export.GetProperty("subject").EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));

        Assert.Equal(
            ["detail", "included", "name"],
            export.GetProperty("sources").EnumerateArray().First()
                .EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));

        Assert.Equal(
            ["entity", "lawfulBasis", "link", "recordCount", "records", "retention", "table", "treatment"],
            export.GetProperty("sections").EnumerateArray().First()
                .EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    /// <summary>
    /// <c>link</c> and <c>treatment</c> are JSON <b>numbers</b>, not strings.
    ///
    /// <para>The page switches on the integer and falls back to rendering the raw value when it
    /// does not recognise one. A converter that turned these into <c>"Subject"</c> and
    /// <c>"FullRecord"</c> would therefore not throw, would not fail a TypeScript build, and
    /// would not fail a single web test — the page would simply show <c>Subject</c> and
    /// <c>FullRecord</c>, untranslated, in the "what is held about you" column of a compliance
    /// screen, in both languages, forever.</para>
    /// </summary>
    [Fact]
    public async Task Link_and_treatment_are_numbers_on_the_wire()
    {
        var (client, _, _) = await SignInAsync(Roles.Employee);

        var export = await MyExportAsync(client);

        var sections = export.GetProperty("sections").EnumerateArray().ToList();
        Assert.NotEmpty(sections);

        foreach (var section in sections)
        {
            Assert.Equal(JsonValueKind.Number, section.GetProperty("link").ValueKind);
            Assert.Equal(JsonValueKind.Number, section.GetProperty("treatment").ValueKind);
            Assert.Equal(JsonValueKind.Number, section.GetProperty("recordCount").ValueKind);
        }
    }

    /// <summary>
    /// The exact integers, against the exact enum members, for every value the page has a word
    /// for. Reordering <see cref="SubjectLink"/> or <see cref="ExportTreatment"/> relabels a
    /// person's own data on screen; this is what makes that a red build instead of a wrong page.
    ///
    /// <para>The numbers are the ones <c>SUBJECT_LINK</c> and <c>EXPORT_TREATMENT</c> hold in
    /// <c>web/src/features/profile/api/gdpr.ts</c>. Change one here and change it there.</para>
    /// </summary>
    [Fact]
    public async Task The_enum_numbers_are_the_ones_the_privacy_page_encodes()
    {
        var (client, _, _) = await SignInAsync(Roles.Employee);

        var export = await MyExportAsync(client);

        // Not read from the enum: an assertion of `(int)SubjectLink.Actor` would follow a
        // renumbering rather than catch it. See the class remarks.
        Assert.Equal(0, (int)SubjectLink.None);
        Assert.Equal(1, (int)SubjectLink.Subject);
        Assert.Equal(2, (int)SubjectLink.Actor);
        Assert.Equal(3, (int)SubjectLink.ThroughParent);

        Assert.Equal(0, (int)ExportTreatment.None);
        Assert.Equal(1, (int)ExportTreatment.FullRecord);
        Assert.Equal(2, (int)ExportTreatment.Reference);

        // And the serialiser really does write those numbers, for a section whose
        // classification is known independently from the map.
        var sections = export.GetProperty("sections").EnumerateArray()
            .ToDictionary(s => s.GetProperty("entity").GetString()!);

        foreach (var entry in SubjectDataMap.Entries.Where(e => e.Export != ExportTreatment.None))
        {
            var section = sections[entry.Entity];
            Assert.Equal((int)entry.Link, section.GetProperty("link").GetInt32());
            Assert.Equal((int)entry.Export, section.GetProperty("treatment").GetInt32());
        }

        // The page has a word for each of these, so at least one must actually occur or the
        // labels are guarding nothing. Both an "about you" table and an attributed one appear
        // in any export, because `users` is Subject/FullRecord and the Actor tables are
        // Reference even when empty.
        var links = sections.Values.Select(s => s.GetProperty("link").GetInt32()).ToHashSet();
        var treatments = sections.Values.Select(s => s.GetProperty("treatment").GetInt32()).ToHashSet();
        Assert.Contains(1, links);
        Assert.Contains(2, links);
        Assert.Contains(1, treatments);
        Assert.Contains(2, treatments);
    }

    /// <summary>
    /// Record keys are the EF property names, PascalCase, with owned types flattened as
    /// <c>Navigation.Property</c> — the one place in this payload where the casing is not
    /// camel, because <c>JsonSerializerDefaults.Web</c> sets a property naming policy and not
    /// a <i>dictionary key</i> policy.
    ///
    /// <para>The privacy page's consent panel depends on precisely this: it has no consent
    /// endpoint to read (there is none in the API) and derives the flags by filtering the
    /// account record for keys beginning <c>Consent.</c>. Camel-cased dictionary keys would
    /// empty that panel silently.</para>
    /// </summary>
    [Fact]
    public async Task Record_keys_are_pascal_case_and_owned_types_keep_their_dotted_prefix()
    {
        var (client, _, email) = await SignInAsync(Roles.Employee);

        var export = await MyExportAsync(client);

        var account = export.GetProperty("sections").EnumerateArray()
            .Single(s => s.GetProperty("entity").GetString() == "User")
            .GetProperty("records").EnumerateArray().Single();

        Assert.Equal(email, account.GetProperty("Email").GetString());
        Assert.Equal(JsonValueKind.True, account.GetProperty("Consent.Essential").ValueKind);

        // The six columns of UserConsent, all of them, under that prefix. The panel lists
        // whatever it finds, so a column dropped from the export vanishes from the page
        // rather than showing as withheld.
        var consentKeys = account.EnumerateObject()
            .Select(p => p.Name)
            .Where(n => n.StartsWith("Consent.", StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal);
        Assert.Equal(
            [
                "Consent.Analytics",
                "Consent.Demographics",
                "Consent.Essential",
                "Consent.Marketing",
                "Consent.Personalization",
                "Consent.ThirdParty",
            ],
            consentKeys);

        // ConsentUpdatedAt is a column of `users` itself, not of the owned type, and the panel
        // reads it unprefixed.
        Assert.True(account.TryGetProperty("ConsentUpdatedAt", out _));

        // No camelCased twin anywhere in the record: if a dictionary key policy were ever
        // added, this is the assertion that says so in one line.
        Assert.False(account.TryGetProperty("email", out _));
        Assert.False(account.TryGetProperty("consent.essential", out _));
    }

    /// <summary>
    /// The completeness flag and the store list the page renders its warning from.
    ///
    /// <para>The page renders that warning <i>from the flag</i> rather than unconditionally,
    /// so that the day the tracking-service gap closes the warning disappears on its own. That
    /// only works if <c>complete</c> is a real boolean tracking a real condition — which today
    /// is false, with the unread store named in <c>sources</c>.</para>
    /// </summary>
    [Fact]
    public async Task Completeness_is_a_boolean_and_every_unread_store_is_named()
    {
        var (client, _, _) = await SignInAsync(Roles.Employee);

        var export = await MyExportAsync(client);

        Assert.Equal(JsonValueKind.False, export.GetProperty("complete").ValueKind);

        var unread = export.GetProperty("sources").EnumerateArray()
            .Where(s => !s.GetProperty("included").GetBoolean())
            .ToList();
        Assert.NotEmpty(unread);
        Assert.All(unread, s => Assert.False(string.IsNullOrWhiteSpace(s.GetProperty("detail").GetString())));

        // `limitations` is the array the page repeats verbatim instead of paraphrasing. An
        // empty one would render an empty list under a heading promising caveats.
        var limitations = export.GetProperty("limitations").EnumerateArray().ToList();
        Assert.NotEmpty(limitations);
        Assert.All(limitations, l => Assert.Equal(JsonValueKind.String, l.ValueKind));
    }
}
