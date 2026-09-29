using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// The three routes the Excel intake wizard drives: the template it hands out, the parse that
/// turns a filled file into reviewable rows, and the reviewed rows going in.
///
/// <para>Separate from <c>BulkImportEndpointsTests</c> on purpose. That file is the CSV
/// contract and must keep passing untouched, because the refactor these routes required moved
/// its validation into a shared method: if the CSV tests go red, the shared body changed
/// behaviour and the wizard is not the only thing affected.</para>
/// </summary>
[Collection("Postgres")]
public class IntakeWizardEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"intake-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;

    /// <summary>A department the company retired: somewhere nobody new may be placed.</summary>
    private const string RetiredDepartment = "Calidad retirada";

    public IntakeWizardEndpointsTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Intake Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        var other = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Other Intake Co",
            EmailDomain = $"intake-other-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.AddRange(company, other);
        _companyId = company.Id;
        _otherCompanyId = other.Id;

        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Name = "Ingeniería",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Name = RetiredDepartment,
            IsActive = false,
            CreatedAt = DateTimeOffset.UtcNow,
        });

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Intake Admin", email, "A-good-passw0rd"));
        var created = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.False(string.IsNullOrEmpty(created));

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static MultipartFormDataContent FileForm(byte[] bytes, Guid companyId, string fileName)
    {
        var form = new MultipartFormDataContent();
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType =
            new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        form.Add(content, "file", fileName);
        form.Add(new StringContent(companyId.ToString()), "companyId");
        return form;
    }

    [Fact]
    public async Task The_template_is_a_workbook_carrying_the_companys_own_departments()
    {
        var client = await AdminClientAsync();

        var response = await client.GetAsync($"/admin/users/bulk-import/template?companyId={_companyId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var bytes = await response.Content.ReadAsByteArrayAsync();

        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        Assert.True(workbook.Worksheets.Contains(IntakeWorkbook.PeopleSheet));

        // The department seeded above must be somewhere in the file, because that is the whole
        // reason the template is generated per company rather than served as a static asset.
        var found = workbook.Worksheets
            .SelectMany(sheet => sheet.CellsUsed())
            .Any(cell => cell.GetString() == "Ingeniería");
        Assert.True(found, "the template did not carry the company's department");
    }

    [Fact]
    public async Task The_template_refuses_another_companys_id()
    {
        var client = await AdminClientAsync();

        var response = await client.GetAsync($"/admin/users/bulk-import/template?companyId={_otherCompanyId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// The round trip that matters in production: download the template, fill it, upload it,
    /// get rows back. A unit test proves the parser reads the writer; this proves the two
    /// routes hand the same file to each other over HTTP.
    /// </summary>
    [Fact]
    public async Task A_filled_template_parses_back_into_rows_over_http()
    {
        var client = await AdminClientAsync();

        var templateBytes = await (await client.GetAsync($"/admin/users/bulk-import/template?companyId={_companyId}"))
            .Content.ReadAsByteArrayAsync();

        byte[] filled;
        using (var input = new MemoryStream(templateBytes))
        using (var workbook = new XLWorkbook(input))
        {
            var sheet = workbook.Worksheet(IntakeWorkbook.PeopleSheet);
            sheet.Cell(5, 1).Value = "Ana Rojas";
            sheet.Cell(5, 2).Value = "ana.intake@example.test";
            sheet.Cell(5, 3).Value = "Colaborador";
            sheet.Cell(5, 4).Value = "Ingeniería";
            using var output = new MemoryStream();
            workbook.SaveAs(output);
            filled = output.ToArray();
        }

        var response = await client.PostAsync(
            "/admin/users/bulk-import/parse", FileForm(filled, _companyId, "personas.xlsx"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var parsed = await response.Content.ReadFromJsonAsync<IntakeParseResult>();
        Assert.Empty(parsed!.Problems);
        var row = Assert.Single(parsed.Rows);
        Assert.Equal("Ana Rojas", row.Name);
        Assert.Equal(Roles.Employee, row.Role);
        Assert.Equal("Ingeniería", row.Department);
    }

    [Fact]
    public async Task A_file_that_is_not_a_workbook_is_a_400_not_a_500()
    {
        var client = await AdminClientAsync();

        var response = await client.PostAsync(
            "/admin/users/bulk-import/parse",
            FileForm("name,email\nnot,a-workbook"u8.ToArray(), _companyId, "personas.xlsx"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        // The code is what the screen translates; the English sentence is not for the admin.
        var body = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        Assert.Equal("not_a_workbook", body!["code"]);
    }

    [Fact]
    public async Task The_template_offers_no_retired_department()
    {
        var client = await AdminClientAsync();

        var bytes = await (await client.GetAsync($"/admin/users/bulk-import/template?companyId={_companyId}"))
            .Content.ReadAsByteArrayAsync();

        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        var cells = workbook.Worksheets.SelectMany(sheet => sheet.CellsUsed()).Select(cell => cell.GetString()).ToList();
        Assert.Contains("Ingeniería", cells);
        Assert.DoesNotContain(RetiredDepartment, cells);
    }

    /// <summary>
    /// Every reason a row is refused carries a stable code the Spanish screen can translate, and
    /// a duplicate says WHICH duplicate it is: already a person, already invited, or twice here.
    /// </summary>
    [Fact]
    public async Task Each_refused_row_names_its_reason_as_a_code()
    {
        var client = await AdminClientAsync();
        var invited = $"invited.{Guid.NewGuid():N}@example.test";
        // Invited the way the product invites: an approved row through this same route.
        var invite = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId, Preview: false, Rows: [new BulkImportRowInput(5, "Invited", invited, "Colaborador", null)]));
        Assert.Equal("invited", Assert.Single((await invite.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows).Status);
        // On the company's own domain: signup refuses one no company owns.
        var existing = $"existing.{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await _factory.CreateClient().PostAsJsonAsync("/auth/signup", new SignupRequest("Existing Person", existing, "A-good-passw0rd"));
        Assert.True(signup.IsSuccessStatusCode, $"signup: {signup.StatusCode}");
        var twice = $"twice.{Guid.NewGuid():N}@example.test";

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId,
            Preview: true,
            Rows:
            [
                new BulkImportRowInput(5, "", "no-at-sign", "Colaborador", null),
                new BulkImportRowInput(6, "Gerente Person", $"gerente.{Guid.NewGuid():N}@example.test", "Gerente", null),
                new BulkImportRowInput(7, "Retired Dept", $"retired.{Guid.NewGuid():N}@example.test", "Colaborador", RetiredDepartment),
                new BulkImportRowInput(8, "Existing", existing, "Colaborador", null),
                new BulkImportRowInput(9, "Invited", invited, "Colaborador", null),
                new BulkImportRowInput(10, "Twice A", twice, "Colaborador", null),
                new BulkImportRowInput(11, "Twice B", twice, "Colaborador", null),
            ]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = (await response.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows.ToDictionary(r => r.RowNumber);
        Assert.Equal(["name_required", "invalid_email"], rows[5].Issues.Select(i => i.Code));
        Assert.Equal(new BulkImportIssue("invalid_role", "Gerente"), Assert.Single(rows[6].Issues));
        Assert.Equal(new BulkImportIssue("department_not_found", RetiredDepartment), Assert.Single(rows[7].Issues));
        Assert.Equal("already_user", Assert.Single(rows[8].Issues).Code);
        Assert.Equal("already_invited", Assert.Single(rows[9].Issues).Code);
        Assert.Equal("valid", rows[10].Status);
        Assert.Empty(rows[10].Issues);
        Assert.Equal("repeated_in_file", Assert.Single(rows[11].Issues).Code);
        Assert.All([rows[8], rows[9], rows[11]], row => Assert.Equal("duplicate", row.Status));
    }

    [Fact]
    public async Task Parsing_refuses_another_companys_id()
    {
        var client = await AdminClientAsync();
        var templateBytes = IntakeTemplateWorkbook.Build("Other Intake Co", []);

        var response = await client.PostAsync(
            "/admin/users/bulk-import/parse", FileForm(templateBytes, _otherCompanyId, "personas.xlsx"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Reviewed_rows_in_preview_create_nothing()
    {
        var client = await AdminClientAsync();

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId,
            Preview: true,
            Rows: [new BulkImportRowInput(5, "Preview Person", "preview.person@example.test", "Colaborador", null)]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal("valid", Assert.Single(result!.Rows).Status);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.UserInvitations.AnyAsync(i => i.Email == "preview.person@example.test"));
    }

    [Fact]
    public async Task Approved_rows_create_invitations_and_keep_the_row_number_from_the_file()
    {
        var client = await AdminClientAsync();

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId,
            Preview: false,
            Rows:
            [
                new BulkImportRowInput(5, "Approved Person", "approved.person@example.test", "Colaborador", "Ingeniería"),
                new BulkImportRowInput(9, "No Email", "", "Colaborador", null),
            ]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();

        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal(1, result.ErrorCount);
        // The row numbers are the spreadsheet's, so the admin can find the bad row in their file.
        Assert.Equal([5, 9], result.Rows.Select(r => r.RowNumber));
        Assert.Equal("invited", result.Rows[0].Status);
        Assert.Equal("error", result.Rows[1].Status);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var invitation = await db.UserInvitations.FirstOrDefaultAsync(i => i.Email == "approved.person@example.test");
        Assert.NotNull(invitation);
        Assert.Equal(_companyId, invitation!.CompanyId);
        Assert.Equal(Roles.Employee, invitation.Role);
    }

    /// <summary>
    /// The property the whole role vocabulary exists to hold. A reviewed row is JSON the admin's
    /// browser sent, so it can name any string at all; company_admin must not be one that works.
    /// </summary>
    [Theory]
    [InlineData("company_admin")]
    [InlineData("super_admin")]
    [InlineData("administrador")]
    public async Task Reviewed_rows_cannot_mint_an_administrator(string role)
    {
        var client = await AdminClientAsync();
        var email = $"escalate-{Guid.NewGuid():N}@example.test";

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId,
            Preview: false,
            Rows: [new BulkImportRowInput(5, "Escalation Attempt", email, role, null)]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal("error", Assert.Single(result!.Rows).Status);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.UserInvitations.AnyAsync(i => i.Email == email));
    }

    [Fact]
    public async Task Reviewed_rows_refuse_another_companys_id()
    {
        var client = await AdminClientAsync();

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _otherCompanyId,
            Preview: true,
            Rows: [new BulkImportRowInput(5, "Wrong Co", "wrong.co@example.test", "Colaborador", null)]));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
