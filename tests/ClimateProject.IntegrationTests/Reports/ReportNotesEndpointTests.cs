using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
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
/// «Notas de TIMS» through the API (ruled 2026-11-19): set on <c>POST /admin/reports</c>,
/// replaced by <c>PUT /admin/reports/{id}/notes</c>, returned on the detail, bounded at
/// <see cref="ReportNotes.MaxLength"/>, audited under the report's company, printed in the
/// downloaded PDF and carried by the report's share link.
/// </summary>
[Collection("Postgres")]
public class ReportNotesEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"notes-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportNotesEndpointTests(PostgresContainerFixture postgres)
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
            Name = "Notes Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Notes_set_at_create_come_back_on_the_detail_in_both_languages()
    {
        var client = await ClientAsync(Roles.CompanyAdmin);
        var notes = new ReportNotesDto(
            IntroEs: "Introducción: el año en cifras.\n\nSegundo párrafo, con ñ.",
            IntroEn: "Introduction.",
            ConclusionsEs: "  Conclusiones.  ",
            RecommendationsEn: "Recommendations.");

        var created = await CreateAsync(client, notes);
        Assert.Equal(notes with { ConclusionsEs = "Conclusiones." }, created.Notes);

        var read = await client.GetFromJsonAsync<ReportDetail>($"/admin/reports/{created.Id}");
        Assert.Equal(created.Notes, read!.Notes);
    }

    [Fact]
    public async Task Put_replaces_every_note_and_a_blank_field_clears_one()
    {
        var client = await ClientAsync(Roles.CompanyAdmin);
        var created = await CreateAsync(client, new ReportNotesDto(IntroEs: "Vieja", ConclusionsEn: "Old"));

        var response = await client.PutAsJsonAsync(
            $"/admin/reports/{created.Id}/notes",
            new ReportNotesDto(IntroEs: "Nueva", ConclusionsEn: "   "));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new ReportNotesDto(IntroEs: "Nueva"), (await response.Content.ReadFromJsonAsync<ReportDetail>())!.Notes);
        var read = await client.GetFromJsonAsync<ReportDetail>($"/admin/reports/{created.Id}");
        Assert.Equal(new ReportNotesDto(IntroEs: "Nueva"), read!.Notes);
    }

    [Fact]
    public async Task A_note_over_the_maximum_is_refused_with_its_code_on_create_and_on_put()
    {
        var client = await ClientAsync(Roles.CompanyAdmin);
        var tooLong = new string('x', ReportNotes.MaxLength + 1);

        var create = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Informe", null, "summary", _companyId, "pdf", null, Notes: new ReportNotesDto(RecommendationsEs: tooLong)));
        await AssertTooLongAsync(create, "recommendationsEs");

        var created = await CreateAsync(client, new ReportNotesDto(IntroEs: new string('y', ReportNotes.MaxLength)));
        Assert.Equal(ReportNotes.MaxLength, created.Notes.IntroEs!.Length);

        var put = await client.PutAsJsonAsync($"/admin/reports/{created.Id}/notes", new ReportNotesDto(IntroEn: tooLong));
        await AssertTooLongAsync(put, "introEn");

        // Refused means nothing was written.
        var read = await client.GetFromJsonAsync<ReportDetail>($"/admin/reports/{created.Id}");
        Assert.Equal(created.Notes, read!.Notes);
    }

    [Fact]
    public async Task Another_companys_admin_cannot_write_the_notes()
    {
        var owner = await ClientAsync(Roles.CompanyAdmin);
        var created = await CreateAsync(owner, new ReportNotesDto(IntroEs: "Nuestra"));

        var otherCompany = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            db.Companies.Add(new Company { Id = otherCompany, Name = "Other", EmailDomain = $"o-{otherCompany:N}.test", CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        });
        var stranger = await ClientAsync(Roles.CompanyAdmin, otherCompany);

        var response = await stranger.PutAsJsonAsync($"/admin/reports/{created.Id}/notes", new ReportNotesDto(IntroEs: "Ajena"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var read = await owner.GetFromJsonAsync<ReportDetail>($"/admin/reports/{created.Id}");
        Assert.Equal("Nuestra", read!.Notes.IntroEs);
    }

    /// <summary>
    /// A TIMS operator without a company of their own still leaves a row, filed under the
    /// report's company -- the middleware alone writes none for a company-less caller.
    /// </summary>
    [Fact]
    public async Task A_company_less_super_admins_note_edit_is_audited_under_the_reports_company()
    {
        var owner = await ClientAsync(Roles.CompanyAdmin);
        var created = await CreateAsync(owner, null);
        var operatorClient = await ClientAsync(Roles.SuperAdmin, companyless: true);

        var response = await operatorClient.PutAsJsonAsync(
            $"/admin/reports/{created.Id}/notes",
            new ReportNotesDto(ConclusionsEs: "Conclusiones de TIMS."));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await WithDbAsync(async db =>
        {
            var row = await db.AuditLogs.SingleAsync(a =>
                a.CompanyId == _companyId
                && a.ResourceId == created.Id.ToString()
                && a.Action == "admin.reports.notes.update");
            Assert.True(row.Success);
            Assert.NotNull(row.UserId);
            Assert.Contains("Conclusiones de TIMS.", row.Details ?? string.Empty, StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task The_downloaded_pdf_prints_the_notes_in_the_reports_language_and_only_those()
    {
        var client = await ClientAsync(Roles.CompanyAdmin);
        // This company has no surveys, so the document's language is the fallback, English.
        var created = await CreateAsync(client, new ReportNotesDto(
            IntroEs: "Introducción en español.",
            IntroEn: "Our introduction to the year.",
            RecommendationsEn: "Review the workload of the front desk."));

        var response = await client.PostAsync($"/admin/reports/{created.Id}/download", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var text = Encoding.Latin1.GetString(await response.Content.ReadAsByteArrayAsync());
        Assert.Contains("(Introduction) Tj", text, StringComparison.Ordinal);
        Assert.Contains("(Our introduction to the year.) Tj", text, StringComparison.Ordinal);
        Assert.Contains("(Recommendations) Tj", text, StringComparison.Ordinal);
        Assert.Contains("(Review the workload of the front desk.) Tj", text, StringComparison.Ordinal);
        Assert.DoesNotContain("(Conclusions) Tj", text, StringComparison.Ordinal);
        // Never the other language's words in this document.
        Assert.DoesNotContain("espa", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_share_link_carries_the_notes_in_the_reports_language()
    {
        var client = await ClientAsync(Roles.CompanyAdmin);
        var created = await CreateAsync(client, new ReportNotesDto(IntroEs: "Solo español", ConclusionsEn: "Our conclusions."));
        var mint = await client.PostAsJsonAsync($"/admin/reports/{created.Id}/share", new CreateReportShareRequest(null));
        var share = (await mint.Content.ReadFromJsonAsync<CreateReportShareResponse>())!;

        var raw = await _factory.CreateClient().GetStringAsync(share.Path);

        using var json = JsonDocument.Parse(raw);
        var notes = json.RootElement.GetProperty("notes");
        Assert.Equal("en", notes.GetProperty("locale").GetString());
        Assert.Equal(JsonValueKind.Null, notes.GetProperty("introduction").ValueKind);
        Assert.Equal("Our conclusions.", notes.GetProperty("conclusions").GetString());
        Assert.DoesNotContain("Solo español", raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_report_without_notes_shares_none()
    {
        var client = await ClientAsync(Roles.CompanyAdmin);
        var created = await CreateAsync(client, null);
        var mint = await client.PostAsJsonAsync($"/admin/reports/{created.Id}/share", new CreateReportShareRequest(null));
        var share = (await mint.Content.ReadFromJsonAsync<CreateReportShareResponse>())!;

        using var json = JsonDocument.Parse(await _factory.CreateClient().GetStringAsync(share.Path));
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("notes").ValueKind);
    }

    // ------------------------------------------------------------------
    // Support
    // ------------------------------------------------------------------

    private static async Task AssertTooLongAsync(HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(AdminRefusals.ReportNotesTooLong, body.RootElement.GetProperty("code").GetString());
        Assert.Equal(field, body.RootElement.GetProperty("field").GetString());
        Assert.Equal(ReportNotes.MaxLength, body.RootElement.GetProperty("maxLength").GetInt32());
    }

    private async Task<ReportDetail> CreateAsync(HttpClient client, ReportNotesDto? notes)
    {
        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Informe de clima", null, "summary", _companyId, "pdf", null, Notes: notes));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReportDetail>())!;
    }

    private async Task<HttpClient> ClientAsync(string role, Guid? companyId = null, bool companyless = false)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = companyless ? null : companyId ?? _companyId;
            await db.SaveChangesAsync();
        });

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> work)
    {
        using var scope = _factory.Services.CreateScope();
        await work(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }
}
