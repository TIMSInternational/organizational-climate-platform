using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Reports.Rendering;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

/// <summary>
/// <c>POST /admin/reports/{id}/download</c> as an administrator experiences it: a file, of the
/// format the row records, with a name.
///
/// <para>
/// Held apart from <see cref="ReportEndpointsTests"/> because what it asserts is a different
/// kind of claim. That class asserts on the stored document -- the numbers, the suppression, the
/// tenancy. This one asserts on the HTTP response: the status, the <c>Content-Type</c>, the
/// <c>Content-Disposition</c> filename and the first bytes of the body. Those are what broke for
/// a year without a single test noticing, because the only download test read the response as
/// JSON and asserted a counter.
/// </para>
/// </summary>
[Collection("Postgres")]
public class ReportDownloadEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"dl-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportDownloadEndpointTests(PostgresContainerFixture postgres)
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
            Name = "Download Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ==================================================================
    // The file
    // ==================================================================

    /// <summary>
    /// req: downloading a <c>pdf</c> report returns a PDF.
    /// </summary>
    /// <remarks>
    /// Every assertion here is about the wire, and the body one is about the bytes rather than
    /// the length: a 400-byte response with a 200 status and the right content type is exactly
    /// what the endpoint used to send (a JSON <c>ReportDetail</c>), so "the body is not empty"
    /// would have passed against the defect this closes. <c>%PDF-</c> would not have.
    /// </remarks>
    [Fact]
    public async Task A_pdf_report_downloads_as_a_pdf_file()
    {
        var client = await AdminClientAsync();
        var created = await CreateAsync(client, "Clima Q3 2026", ReportFormats.Pdf);

        var response = await client.PostAsync($"/admin/reports/{created.Id}/download", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("clima-q3-2026.pdf", response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(bytes, 0, 5), StringComparison.Ordinal);

        // A real document, not a header and a trailer: this report's own title is drawn on it.
        var text = Encoding.Latin1.GetString(bytes);
        Assert.Contains("Clima Q3 2026", text, StringComparison.Ordinal);
        // ISO 32000-1 requires the trailer; a truncated write is the failure mode of a
        // hand-rolled serialiser and it is invisible to a length assertion.
        Assert.Contains("%%EOF", text, StringComparison.Ordinal);
    }

    /// <summary>req: downloading a <c>csv</c> report returns a CSV, not the PDF.</summary>
    [Fact]
    public async Task A_csv_report_downloads_as_a_csv_file()
    {
        var client = await AdminClientAsync();
        var created = await CreateAsync(client, "Datos Q3", ReportFormats.Csv);

        var response = await client.PostAsync($"/admin/reports/{created.Id}/download", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("datos-q3.csv", response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);

        var bytes = await response.Content.ReadAsByteArrayAsync();

        // The BOM, first. Without it Excel renders every accented character in a
        // Spanish-language export as mojibake, and the export is the artefact an admin forwards
        // to people who never see the app -- CsvWriter.ToBytes documents the choice.
        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);

        var text = Encoding.UTF8.GetString(bytes.AsSpan(3));
        Assert.StartsWith(
            string.Join(",", ReportRenderer.Columns.Select(c => $"\"{c}\"")),
            text,
            StringComparison.Ordinal);
        Assert.Contains($"\"{ReportRenderer.ReportSection}\"", text, StringComparison.Ordinal);
        Assert.Contains(created.Id.ToString(), text, StringComparison.Ordinal);
    }

    /// <summary>
    /// Rows written before <c>CreateAsync</c> validated the column hold formats no renderer
    /// knows -- <c>excel</c> most of all, which the web offered for a year. They must still
    /// produce a file.
    /// </summary>
    [Theory]
    [InlineData("excel")]
    [InlineData("xlsx")]
    [InlineData("")]
    public async Task A_legacy_format_no_renderer_knows_downloads_as_a_pdf_rather_than_failing(string storedFormat)
    {
        var client = await AdminClientAsync();
        var created = await CreateAsync(client, "Legacy", ReportFormats.Pdf);

        // Written straight to the column, because the endpoint now refuses it: this is a row
        // that predates the validation, which is exactly the case under test.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var report = await db.Reports.FirstAsync(r => r.Id == created.Id);
            report.Format = storedFormat;
            await db.SaveChangesAsync();
        }

        var response = await client.PostAsync($"/admin/reports/{created.Id}/download", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(bytes, 0, 5), StringComparison.Ordinal);
    }

    /// <summary>
    /// <c>report_output</c> is <c>jsonb</c>, so Postgres accepts the bare JSON string the
    /// pre-#88 stub wrote. Such a row must download, not 500.
    /// </summary>
    [Fact]
    public async Task A_report_whose_stored_document_predates_the_generator_still_downloads()
    {
        var client = await AdminClientAsync();
        var created = await CreateAsync(client, "Ancient", ReportFormats.Pdf);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var report = await db.Reports.FirstAsync(r => r.Id == created.Id);
            report.ReportOutput = "\"Report generation is stubbed -- no real rendering yet.\"";
            await db.SaveChangesAsync();
        }

        var response = await client.PostAsync($"/admin/reports/{created.Id}/download", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var text = Encoding.Latin1.GetString(await response.Content.ReadAsByteArrayAsync());
        Assert.Contains("%PDF-", text, StringComparison.Ordinal);
        // It says which report it is and why it is empty, rather than being a blank page.
        Assert.Contains("no stored document", text, StringComparison.Ordinal);
    }

    // ==================================================================
    // The order the failures come in, unchanged by the file
    // ==================================================================

    /// <summary>
    /// A missing report is 404; another tenant's report is 403.
    /// </summary>
    /// <remarks>
    /// <b>Measured, not assumed.</b> <c>ReportShareEndpoints</c> answers 404 for a foreign
    /// report precisely so a 403 cannot confirm the id exists, and this endpoint does NOT --
    /// it has always answered <c>Results.Forbid()</c> (<c>ReportEndpoints.cs</c>), and #93
    /// shipped it that way. That difference is left exactly as it was: changing a status code
    /// is a decision with its own tests, not a side effect of adding a renderer. What is
    /// asserted here is that the lookup and the authorisation still run BEFORE the render, so
    /// no byte of a document reaches a caller who is refused.
    /// </remarks>
    [Fact]
    public async Task An_unknown_report_is_404_and_another_tenants_report_is_refused_before_any_render()
    {
        var client = await AdminClientAsync();

        var missing = await client.PostAsync($"/admin/reports/{Guid.NewGuid()}/download", null);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        var foreignCompanyId = Guid.NewGuid();
        Guid foreignReportId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Companies.Add(new Company
            {
                Id = foreignCompanyId,
                Name = "Other Co",
                EmailDomain = $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            // Any user of this test's own company: `reports.created_by` is a required FK to
            // `users` (ReportConfiguration), so the row needs a real account behind it.
            var owner = await db.Users.FirstAsync(u => u.CompanyId == _companyId);
            var foreign = new Report
            {
                Id = Guid.NewGuid(),
                Title = "Not yours",
                Type = "climate_summary",
                CompanyId = foreignCompanyId,
                CreatedBy = owner.Id,
                Status = "completed",
                Format = ReportFormats.Pdf,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Reports.Add(foreign);
            foreignReportId = foreign.Id;
            await db.SaveChangesAsync();
        }

        var forbidden = await client.PostAsync($"/admin/reports/{foreignReportId}/download", null);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        // And nothing of the document leaked in the refusal.
        Assert.NotEqual("application/pdf", forbidden.Content.Headers.ContentType?.MediaType);
    }

    // ==================================================================
    // Format validation at create
    // ==================================================================

    /// <summary>
    /// req: only a format this solution can render may be stored, so that a stored value is a
    /// promise the download can keep.
    /// </summary>
    /// <remarks>
    /// <c>excel</c> is the one that matters: <c>ReportForm.tsx</c> offered it beside pdf and csv
    /// and nothing ever produced a spreadsheet. It is refused rather than downgraded to a PDF --
    /// see <c>docs/decisions/report-rendering.md</c> -- because a row that records "excel" and a
    /// file that is a PDF is the worse half of both options.
    /// </remarks>
    [Theory]
    [InlineData("excel")]
    [InlineData("xlsx")]
    [InlineData("docx")]
    [InlineData("json")]
    [InlineData("")]
    [InlineData("   ")]
    public async Task An_unrenderable_format_is_refused_at_create(string format)
    {
        var client = await AdminClientAsync();

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Bad format", null, "climate_summary", _companyId, format, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // The existing error shape -- `{ "message": ... }` -- and a message that names both
        // acceptable values, so a caller can fix the request from the response alone.
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(error?.Message);
        Assert.Contains(ReportFormats.Pdf, error.Message, StringComparison.Ordinal);
        Assert.Contains(ReportFormats.Csv, error.Message, StringComparison.Ordinal);

        // Nothing was written. A 400 that still left a row would be worse than a 201.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Reports.AnyAsync(r => r.CompanyId == _companyId && r.Title == "Bad format"));
    }

    [Theory]
    [InlineData("pdf", "pdf")]
    [InlineData("PDF", "pdf")]
    [InlineData(" csv ", "csv")]
    public async Task A_supported_format_is_stored_in_its_canonical_spelling(string sent, string stored)
    {
        var client = await AdminClientAsync();

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            $"Case {sent}", null, "climate_summary", _companyId, sent, null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();

        // One spelling in the column, so a later filter or group-by does not see "PDF", "pdf"
        // and " csv " as three formats.
        Assert.Equal(stored, created!.Format);
    }

    /// <summary>
    /// The title check still runs first. Both are 400s, so a caller who sent neither has to be
    /// told about the title -- the field they can see -- rather than about the dropdown.
    /// </summary>
    [Fact]
    public async Task A_missing_title_is_reported_before_a_bad_format()
    {
        var client = await AdminClientAsync();

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "  ", null, "climate_summary", _companyId, "excel", null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.Equal("Title is required", error?.Message);
    }

    // ------------------------------------------------------------------
    // Support
    // ------------------------------------------------------------------

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

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

    private async Task<ReportDetail> CreateAsync(HttpClient client, string title, string format)
    {
        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            title, "Quarterly summary", "climate_summary", _companyId, format, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReportDetail>())!;
    }
}
