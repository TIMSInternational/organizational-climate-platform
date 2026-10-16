using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Gdpr;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// <c>GET /admin/exports/responses</c> — the platform-wide response workbook.
///
/// The two guarantees worth a database for: only a super admin may read it, and what each
/// sheet can carry is decided by the survey's own anonymity rather than by the writer.
/// </summary>
[Collection("Postgres")]
public class ResponseExportEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"respexport-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _identifiedSurveyId;
    private Guid _anonymousSurveyId;
    private Guid _respondentId;

    // Unique per test instance: IX_users_username is a GLOBAL unique index and every test in
    // this assembly shares one database, so a fixed username collides on the second test.
    private readonly string _username = $"exportco-{Guid.NewGuid():N}"[..20];
    private readonly string _silentEmail = $"carmen-{Guid.NewGuid():N}@example.test";

    public ResponseExportEndpointsTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Export Co",
            EmailDomain = _domain,
            CreatedAt = now,
            Settings = new CompanySettings { Language = "es" },
        };
        db.Companies.Add(company);
        _companyId = company.Id;

        var respondent = new User
        {
            Id = Guid.NewGuid(),
            Name = "Andrés Tafur",
            Email = $"andres-{Guid.NewGuid():N}@{_domain}",
            PasswordHash = "x",
            Role = Roles.Employee,
            CompanyId = _companyId,
            Username = _username,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(respondent);
        _respondentId = respondent.Id;

        // Invited, active, and has answered nothing. The person the morning status mail is
        // actually about.
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            Name = "Carmen Soto",
            Email = _silentEmail,
            PasswordHash = "x",
            Role = Roles.Employee,
            CompanyId = _companyId,
            Username = $"silent-{Guid.NewGuid():N}"[..18],
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        });

        _identifiedSurveyId = Seed(db, company.Id, "Clima identificado", anonymous: false, respondent.Id, respondent.Id, now);
        _anonymousSurveyId = Seed(db, company.Id, "Clima anónimo", anonymous: true, null, respondent.Id, now);

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>One survey, one scale question, one open question, one response to both.</summary>
    private static Guid Seed(
        ClimateProjectDbContext db, Guid companyId, string title, bool anonymous, Guid? userId, Guid createdBy,
        DateTimeOffset now)
    {
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEs = title,
            Language = "es",
            Type = "periodic",
            Status = "active",
            StartDate = now.AddDays(-1),
            EndDate = now.AddDays(10),
            CreatedAt = now,
            UpdatedAt = now,
        };
        survey.Settings.Anonymous = anonymous;
        db.Surveys.Add(survey);

        var scale = new Question
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, TextEs = "Recibo la información a tiempo.",
            Type = "likert", ScaleMin = 1, ScaleMax = 5, Order = 1, Category = "Comunicación", Required = true,
        };
        var open = new Question
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, TextEs = "¿Qué mejoraría?",
            Type = "open_ended", Order = 2, Category = "Preguntas abiertas", Required = false,
        };
        db.Questions.AddRange(scale, open);

        var response = new Response
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            CompanyId = companyId,
            // Null for the anonymous survey, exactly as SurveyResponseEndpoints.StoredUserId writes it.
            UserId = userId,
            SessionId = Guid.NewGuid().ToString("N"),
            Language = "es",
            IsComplete = true,
            IsAnonymous = anonymous,
            StartTime = now.AddMinutes(-30),
            CompletionTime = now,
            TotalTimeSeconds = 1800,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Responses.Add(response);

        db.QuestionResponses.AddRange(
            new QuestionResponse { ResponseId = response.Id, QuestionId = scale.Id, ResponseValue = "\"4\"" },
            new QuestionResponse
            {
                ResponseId = response.Id,
                QuestionId = open.Id,
                ResponseValue = "\"Mi jefe nunca me escucha\"",
            });

        db.ResponseDemographics.Add(new ResponseDemographic
        {
            ResponseId = response.Id,
            Field = "antiguedad",
            // jsonb, like response_value: a bare string is not JSON and Postgres rejects it
            // with 22P02, which is how the write side in SurveyResponseEndpoints stores it too.
            Value = "\"4_a_6_anos\"",
        });

        return survey.Id;
    }

    private async Task<HttpClient> ClientAsync(string role)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Export Admin", email, "A-good-passw0rd"));
        Assert.True(signup.IsSuccessStatusCode, $"signup returned {signup.StatusCode}");

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = role == Roles.SuperAdmin ? null : _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task A_company_administrator_cannot_read_the_platform_wide_response_export()
    {
        using var client = await ClientAsync(Roles.CompanyAdmin);

        var response = await client.GetAsync($"/admin/exports/responses?companyId={_companyId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_identified_sheet_names_the_respondent_and_the_anonymous_one_cannot()
    {
        using var client = await ClientAsync(Roles.SuperAdmin);

        var response = await client.GetAsync($"/admin/exports/responses?companyId={_companyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            response.Content.Headers.ContentType?.MediaType);

        using var book = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        var identified = SheetFor(book, "Clima identificado");
        var anonymous = SheetFor(book, "Clima anónimo");

        Assert.Contains("nombre", Header(identified));
        Assert.Equal("Andrés Tafur", identified.Cell(2, 2).GetString());
        Assert.Equal(_username, identified.Cell(2, 4).GetString());

        // Not withheld by this endpoint -- never written. `responses.user_id` is null for an
        // anonymous survey, so there is no name to put in a column, and no column.
        Assert.DoesNotContain("nombre", Header(anonymous));
        Assert.DoesNotContain("usuario", Header(anonymous));
        Assert.True(await UserIdIsNullAsync(_anonymousSurveyId));
        Assert.False(await UserIdIsNullAsync(_identifiedSurveyId));
    }

    /// <summary>
    /// Reversed on 2026-10-16, §6 of who-may-see-an-individual-answer.md: TIMS is the
    /// external processor and the words ARE the analysis, so a super admin's export
    /// returns them. Nothing else moved with it --
    /// <c>A_company_administrator_cannot_read_the_platform_wide_response_export</c> is what
    /// keeps the client company off this surface, and <c>GET /gdpr/access</c> keeps its own
    /// stricter rule. The respondent copy changed in the same release, which is the only
    /// reason this is defensible.
    /// </summary>
    [Fact]
    public async Task The_words_a_respondent_typed_reach_the_super_admins_export()
    {
        using var client = await ClientAsync(Roles.SuperAdmin);

        var response = await client.GetAsync($"/admin/exports/responses?companyId={_companyId}");
        using var book = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        var sheet = SheetFor(book, "Clima identificado");
        var header = Header(sheet);

        Assert.Equal(4d, sheet.Cell(2, header.IndexOf("P01") + 1).GetDouble());

        // Decoded out of jsonb, not passed through. A cell reading `"4_a_6_anos"` with the
        // quotes is what the raw column holds, and it would break every pivot on the column.
        Assert.Equal("4_a_6_anos", sheet.Cell(2, header.IndexOf("antiguedad") + 1).GetString());

        // What the respondent actually typed, not the marker. Asserted both ways round so
        // that returning the marker AND accidentally returning the words are each a failure.
        var typed = sheet.Cell(2, header.IndexOf("P02") + 1).GetString();
        Assert.Contains("nunca me escucha", typed, StringComparison.Ordinal);
        Assert.NotEqual(SubjectDataMap.WithheldAnswerMarker, typed);
    }

    /// <summary>
    /// The listado de pendientes, against the roster's own derivation rather than a second one.
    /// Carmen answered nothing; Andrés completed the identified climate and must not appear in
    /// its pending rows.
    /// </summary>
    [Fact]
    public async Task Pendientes_lists_who_has_not_answered_and_leaves_out_who_has()
    {
        using var client = await ClientAsync(Roles.SuperAdmin);

        var response = await client.GetAsync($"/admin/exports/responses?surveyId={_identifiedSurveyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var book = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        var pending = book.Worksheet("PENDIENTES");
        var rows = pending.RowsUsed().Skip(1)
            .Select(r => (Email: r.Cell(5).GetString(), Status: r.Cell(7).GetString()))
            .ToList();

        Assert.Contains(rows, r => r.Email == _silentEmail && r.Status == "not_started");
        Assert.DoesNotContain(rows, r => r.Email.StartsWith("andres-", StringComparison.Ordinal));

        // RESUMEN counts the same people, so the number in the index and the list agree.
        Assert.Equal(rows.Count, (int)book.Worksheet("RESUMEN").Cell(2, 10).GetDouble());
    }

    private async Task<bool> UserIdIsNullAsync(Guid surveyId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await db.Responses.Where(r => r.SurveyId == surveyId).AllAsync(r => r.UserId == null);
    }

    private static IXLWorksheet SheetFor(XLWorkbook book, string title)
        => book.Worksheets.Single(s => s.Name.Contains(title, StringComparison.Ordinal));

    private static List<string> Header(IXLWorksheet sheet)
        => sheet.Row(1).CellsUsed().Select(c => c.GetString()).ToList();
}
