using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Gdpr;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Gdpr;

/// <summary>
/// The <c>report_shares</c> half of the subject access export (#139 into #144).
///
/// <para>
/// <c>SubjectDataMap</c> classifies <c>report_shares</c> as an <b>Actor</b> table:
/// the subject appears in it as the administrator who minted a public link to a report, or as
/// the one who revoked it. <c>GdprEndpointsTests</c> proves that a section exists for every
/// classified table, but it seeds no share, so an exporter that returned an empty
/// <c>ReportShare</c> section forever would satisfy it — and so would a mint that never
/// recorded who minted. Everything here is driven through the real endpoints, so the
/// attribution the export reads is the attribution the mint and the revoke actually wrote.
/// </para>
///
/// <para>
/// Its own class rather than three more facts in <c>GdprEndpointsTests</c>: this needs an
/// administrator who can create a report and mint a link, where that class's shared seed builds
/// an employee's own survey data by hand. Seeding a share into it would have changed the
/// fixture every erasure and tenant-scope test in the file already depends on.
/// </para>
/// </summary>
[Collection("Postgres")]
public class ReportShareSubjectAccessTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"shr-gdpr-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportShareSubjectAccessTests(PostgresContainerFixture postgres)
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
            Name = "Share GDPR Co",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private async Task<HttpClient> AdminAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Share Admin", email, "a-good-password"));

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<Guid> CreateReportAsync(HttpClient admin, string title)
    {
        var response = await admin.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            title, "Quarterly summary", "climate_summary", _companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReportDetail>())!.Id;
    }

    private static async Task<CreateReportShareResponse> MintAsync(HttpClient admin, Guid reportId)
    {
        var response = await admin.PostAsJsonAsync(
            $"/admin/reports/{reportId}/share", new CreateReportShareRequest(null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreateReportShareResponse>())!;
    }

    /// <summary>The caller's own access export, as the JSON an operator would hand over.</summary>
    private static async Task<string> AccessExportAsync(HttpClient client)
    {
        var response = await client.GetAsync("/gdpr/access");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadAsStringAsync();
    }

    private static JsonElement SharesSection(string export)
        => JsonSerializer.Deserialize<JsonElement>(export)
            .GetProperty("sections").EnumerateArray()
            .Single(s => s.GetProperty("entity").GetString() == "ReportShare");

    // ------------------------------------------------------------------
    // Attribution
    // ------------------------------------------------------------------

    /// <summary>
    /// The two facts <c>report_shares</c> holds about a person: they opened a report to the
    /// public, or they closed it again.
    /// </summary>
    /// <remarks>
    /// Two different administrators, so the two columns cannot be satisfied by one row that
    /// happens to carry the same id twice — a mint that never set <c>created_by</c> would still
    /// show up in the revoker's export if the same person did both.
    ///
    /// The third administrator neither minted nor revoked and is the negative half: an exporter
    /// that returned every share in the tenant would pass the first two assertions and fail
    /// this one, and it is the assertion that stops "name the shares this subject touched" from
    /// degrading into "name the shares".
    /// </remarks>
    [Fact]
    public async Task An_export_names_the_links_the_subject_minted_and_the_ones_they_revoked()
    {
        var minter = await AdminAsync();
        var revoker = await AdminAsync();
        var bystander = await AdminAsync();

        var reportId = await CreateReportAsync(minter, "Clima Organizacional Q3");
        var share = await MintAsync(minter, reportId);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await revoker.DeleteAsync($"/admin/reports/{reportId}/shares/{share.Id}")).StatusCode);

        var minted = SharesSection(await AccessExportAsync(minter));
        Assert.Equal(1, minted.GetProperty("recordCount").GetInt32());
        var mintedRecord = minted.GetProperty("records").EnumerateArray().Single();
        Assert.Equal(share.Id, mintedRecord.GetProperty(SubjectAccessExport.IdKey).GetGuid());
        Assert.Equal("CreatedBy", mintedRecord.GetProperty(SubjectAccessExport.LinkKey).GetString());

        // Labelled by the report the link opens: the share's own id means nothing to the person
        // reading their own export.
        Assert.Equal("Clima Organizacional Q3", mintedRecord.GetProperty(SubjectAccessExport.LabelKey).GetString());

        var revoked = SharesSection(await AccessExportAsync(revoker));
        Assert.Equal(1, revoked.GetProperty("recordCount").GetInt32());
        var revokedRecord = revoked.GetProperty("records").EnumerateArray().Single();
        Assert.Equal(share.Id, revokedRecord.GetProperty(SubjectAccessExport.IdKey).GetGuid());
        Assert.Equal("RevokedBy", revokedRecord.GetProperty(SubjectAccessExport.LinkKey).GetString());

        Assert.Equal(0, SharesSection(await AccessExportAsync(bystander)).GetProperty("recordCount").GetInt32());
    }

    /// <summary>
    /// The export names the link and never the credential that opens it.
    /// </summary>
    /// <remarks>
    /// An access export is a document the subject downloads, keeps and forwards, and
    /// <c>report_shares.token_hash</c> is the hash of a live credential to a company's climate
    /// data. The exporter's remark says the hash never leaves the database; this is the
    /// assertion behind the remark, made against the response body as a string so that it holds
    /// wherever the hash might be put — its own property, appended to a label, or folded into
    /// some future full-record treatment.
    ///
    /// The positive half matters as much: the share id IS in the export. Without it, an
    /// exporter that dropped the section entirely would pass a "does not contain" test
    /// trivially.
    /// </remarks>
    [Fact]
    public async Task An_export_carries_neither_the_share_token_nor_its_hash()
    {
        var minter = await AdminAsync();
        var reportId = await CreateReportAsync(minter, "Clima Organizacional Q4");
        var share = await MintAsync(minter, reportId);

        var export = await AccessExportAsync(minter);

        Assert.Contains(share.Id.ToString(), export, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(ReportShareTokens.Hash(share.Token), export, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(share.Token, export, StringComparison.Ordinal);
    }
}
