using System.Net;
using System.Net.Http.Json;
using System.Text;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// G20: the "Quién ya respondió" roster as a file. ESPH needed it twice on 21 Oct 2026 and it
/// was built by hand from <c>GET /surveys/{id}/participation</c>; this is that, from the
/// product, with the participation endpoint's own authorization and its own rows.
/// </summary>
/// <remarks>
/// The rows are asserted EQUAL to the JSON roster, person by person and in order, rather than
/// re-derived here: the claim is that the file is the screen, and the screen is the JSON.
/// One row is also pinned cell by cell in Spanish, so the words are held independently of
/// <see cref="SurveyRosterCsv"/> itself.
/// </remarks>
[Collection("Postgres")]
public class SurveyRosterExportTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;
    private readonly SurveyTestHarness _harness;
    private readonly string _tag = Guid.NewGuid().ToString("N")[..8];
    private readonly string _mail;
    private Guid _companyId;
    private Guid _authorId;

    public SurveyRosterExportTests(PostgresContainerFixture postgres)
    {
        _postgres = postgres;
        _mail = $"rosterexport-{Guid.NewGuid():N}.test";
        _harness = new SurveyTestHarness(postgres.App, _mail);
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Exporta SA", language: "es");
        _authorId = await SeedPersonAsync("Autora", Roles.CompanyAdmin);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task The_file_holds_the_rosters_rows_in_the_rosters_order_with_spanish_headers()
    {
        // The admin client FIRST: signing it in adds an account to the company, and so a row to
        // the roster. Created after the seed, it would land between the two reads below.
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var marta = await SeedPersonAsync("Marta Villalobos", Roles.Employee, username: $"{_tag}-marta");
        var hugo = await SeedPersonAsync("Hugo Peralta", Roles.Employee, username: $"{_tag}-hugo");
        await SeedPersonAsync("Ana Lucía Mora", Roles.Leader, username: null);
        var survey = await SeedSurveyAsync("Clima Organizacional 2026", credentialMode: null);
        await SeedResponseAsync(survey, marta, complete: true);
        await SeedResponseAsync(survey, hugo, complete: false);

        var view = (await admin.GetFromJsonAsync<SurveyParticipationView>($"/surveys/{survey}/participation"))!;
        var http = await admin.GetAsync($"/surveys/{survey}/participation/export");

        Assert.Equal(HttpStatusCode.OK, http.StatusCode);
        Assert.Equal("text/csv", http.Content.Headers.ContentType?.MediaType);
        var (headers, rows) = ParseCsv(await http.Content.ReadAsByteArrayAsync());

        Assert.Equal(["Nombre", "Correo", "Rol", "Usuario", "Estado", "Última actividad"], headers);
        Assert.Equal(view.Roster.Count, rows.Count);
        Assert.Equal(
            view.Roster.Select(row => SurveyRosterCsv.Fields(row, spanish: true, perSurvey: false, showState: true)
                .Select(field => field ?? string.Empty).ToArray()),
            rows);

        // One row, cell by cell, in the screen's own words.
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var hugoRow = rows.Single(row => row[0] == "Hugo Peralta");
        Assert.Equal("Empleado", hugoRow[2]);
        Assert.Equal($"{_tag}-hugo", hugoRow[3]);
        Assert.Equal("Empezó", hugoRow[4]);
        Assert.Equal(today, hugoRow[5]);
        Assert.Equal(["Terminó"], rows.Where(row => row[0] == "Marta Villalobos").Select(row => row[4]));
        var anaRow = rows.Single(row => row[0] == "Ana Lucía Mora");
        Assert.Equal(["Líder", "", "No ha entrado", ""], anaRow[2..]);

        // Named after the survey and the day, so two downloads do not overwrite each other.
        var name = http.Content.Headers.ContentDisposition?.FileNameStar ?? http.Content.Headers.ContentDisposition?.FileName;
        Assert.Equal($"estado-clima-organizacional-2026-{today}.csv", name?.Trim('"'));
    }

    [Fact]
    public async Task An_english_company_gets_english_headers_and_words()
    {
        var company = await _harness.SeedCompanyAsync("Export Inc", language: "en");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, company);
        var survey = await SeedSurveyAsync("Climate", credentialMode: null, companyId: company);

        var (headers, rows) = ParseCsv(await (await admin.GetAsync($"/surveys/{survey}/participation/export")).Content.ReadAsByteArrayAsync());

        Assert.Equal(["Name", "Email", "Role", "Username", "State", "Last activity"], headers);
        // The admin the harness signed in is the one person on this roster.
        Assert.Equal(["Company administrator", "", "Not opened", ""], Assert.Single(rows)[2..]);
    }

    [Fact]
    public async Task A_per_survey_survey_carries_the_two_code_columns_the_screen_shows()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var keyed = await SeedPersonAsync("Con Código", Roles.Employee);
        await SeedPersonAsync("Sin Código", Roles.Employee);
        var survey = await SeedSurveyAsync("Teletrabajo", credentialMode: CredentialModes.PerSurvey);
        var issued = new DateTimeOffset(2026, 10, 19, 15, 0, 0, TimeSpan.Zero);
        var signedIn = new DateTimeOffset(2026, 10, 21, 16, 30, 0, TimeSpan.Zero);
        await SeedSurveyKeyAsync(survey, keyed, $"{_tag}-tele", issued, signedIn);

        var view = (await admin.GetFromJsonAsync<SurveyParticipationView>($"/surveys/{survey}/participation"))!;
        var (headers, rows) = ParseCsv(await (await admin.GetAsync($"/surveys/{survey}/participation/export")).Content.ReadAsByteArrayAsync());

        Assert.Equal(
            ["Nombre", "Correo", "Rol", "Usuario", "Código enviado", "Último ingreso con el código", "Estado", "Última actividad"],
            headers);
        Assert.Equal(
            view.Roster.Select(row => SurveyRosterCsv.Fields(row, spanish: true, perSurvey: true, showState: true)
                .Select(field => field ?? string.Empty).ToArray()),
            rows);
        // The survey key, not an account username, and the two days in the company's zone (UTC here).
        Assert.Equal([$"{_tag}-tele", "2026-10-19", "2026-10-21"], rows.Single(row => row[0] == "Con Código")[3..6]);
        Assert.Equal(["", "", ""], rows.Single(row => row[0] == "Sin Código")[3..6]);
    }

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    public async Task Someone_who_does_not_administer_the_survey_is_refused(string role)
    {
        var survey = await SeedSurveyAsync("Clima", credentialMode: null);
        var caller = await _harness.ClientAsync(role, _companyId);

        var http = await caller.GetAsync($"/surveys/{survey}/participation/export");

        Assert.Equal(HttpStatusCode.Forbidden, http.StatusCode);
    }

    [Fact]
    public async Task Another_tenants_admin_is_refused()
    {
        var survey = await SeedSurveyAsync("Clima", credentialMode: null);
        var otherCompany = await _harness.SeedCompanyAsync("Otra Co");
        var otherAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, otherCompany);

        var http = await otherAdmin.GetAsync($"/surveys/{survey}/participation/export");

        Assert.Equal(HttpStatusCode.Forbidden, http.StatusCode);
    }

    [Fact]
    public async Task A_super_admin_may_download_it_and_an_anonymous_caller_may_not()
    {
        var survey = await SeedSurveyAsync("Clima", credentialMode: null);
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, null);

        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/surveys/{survey}/participation/export")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _postgres.App.CreateClient().GetAsync($"/surveys/{survey}/participation/export")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await superAdmin.GetAsync($"/surveys/{Guid.NewGuid()}/participation/export")).StatusCode);
    }

    // ------------------------------------------------------------------
    // CSV
    // ------------------------------------------------------------------

    /// <summary>
    /// RFC 4180 as <c>CsvWriter</c> writes it: every field quoted, quotes doubled, CRLF rows, a
    /// UTF-8 BOM. Read character by character so an embedded comma or newline cannot split a
    /// row the writer meant as one.
    /// </summary>
    private static (string[] Headers, List<string[]> Rows) ParseCsv(byte[] bytes)
    {
        var text = Encoding.UTF8.GetString(bytes).TrimStart('﻿');
        var records = new List<string[]>();
        var fields = new List<string>();
        var field = new StringBuilder();
        var quoted = false;

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"')
                {
                    field.Append('"');
                    i++;
                }
                else if (c == '"')
                {
                    quoted = false;
                }
                else
                {
                    field.Append(c);
                }
            }
            else if (c == '"')
            {
                quoted = true;
            }
            else if (c == ',')
            {
                fields.Add(field.ToString());
                field.Clear();
            }
            else if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
            {
                fields.Add(field.ToString());
                field.Clear();
                records.Add([.. fields]);
                fields.Clear();
                i++;
            }
            else
            {
                field.Append(c);
            }
        }

        Assert.Empty(fields);
        Assert.NotEmpty(records);
        return (records[0], records.Skip(1).ToList());
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Task<Guid> SeedPersonAsync(string name, string role, string? username = null)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var person = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"{Guid.NewGuid():N}@{_mail}",
                Name = name,
                Username = username,
                Role = role,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Users.Add(person);
            await db.SaveChangesAsync();
            return person.Id;
        });

    private Task<Guid> SeedSurveyAsync(string title, string? credentialMode, Guid? companyId = null)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var survey = new Survey
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId ?? _companyId,
                CreatedBy = _authorId,
                TitleEn = title,
                TitleEs = title,
                Language = "both",
                Type = "periodic",
                StartDate = now.AddDays(-1),
                EndDate = now.AddDays(10),
                Status = SurveyStatuses.Active,
                Settings = new SurveySettings { Anonymous = false, CredentialMode = credentialMode },
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Surveys.Add(survey);
            await db.SaveChangesAsync();
            return survey.Id;
        });

    private Task SeedSurveyKeyAsync(Guid surveyId, Guid userId, string username, DateTimeOffset issued, DateTimeOffset signedIn)
        => _harness.WithDbAsync(async db =>
        {
            db.SurveyCredentials.Add(new SurveyCredential
            {
                SurveyId = surveyId,
                UserId = userId,
                Username = username,
                PasswordHash = "not-a-real-hash",
                CreatedAt = issued,
                LastSignInAt = signedIn,
            });
            await db.SaveChangesAsync();
            return 0;
        });

    private Task SeedResponseAsync(Guid surveyId, Guid userId, bool complete)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                CompanyId = _companyId,
                UserId = userId,
                DepartmentId = null,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = "es",
                IsComplete = complete,
                IsAnonymous = false,
                StartTime = now.AddMinutes(-5),
                CompletionTime = complete ? now : null,
                TotalTimeSeconds = complete ? 300 : null,
                CreatedAt = now,
                UpdatedAt = now,
            });
            await db.SaveChangesAsync();
            return 0;
        });
}
