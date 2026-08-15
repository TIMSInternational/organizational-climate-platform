using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.OrgStructure;

[Collection("Postgres")]
public class BulkImportEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"bulk-{Guid.NewGuid():N}.test";
    private readonly string _otherCompanyDomain = $"bulk-other-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;

    public BulkImportEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Bulk Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        var otherCompany = new Company { Id = Guid.NewGuid(), Name = "Other Bulk Co", EmailDomain = _otherCompanyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(company, otherCompany);
        _companyId = company.Id;
        _otherCompanyId = otherCompany.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test Admin", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private static MultipartFormDataContent BuildForm(string csv, Guid companyId, bool preview)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new StringContent(csv, Encoding.UTF8, "text/csv");
        form.Add(fileContent, "file", "import.csv");
        form.Add(new StringContent(companyId.ToString()), "companyId");
        form.Add(new StringContent(preview.ToString().ToLowerInvariant()), "preview");
        return form;
    }

    [Fact]
    public async Task Preview_mode_validates_without_creating_users()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nNew Person,newperson@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: true));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal("valid", result.Rows[0].Status);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == "newperson@example.test"));
    }

    [Fact]
    public async Task A_headerless_single_row_csv_is_parsed_not_silently_dropped()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "Headerless Person,headerless@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: true));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Single(result!.Rows);
        Assert.Equal(1, result.SuccessCount);
        Assert.Equal("headerless@example.test", result.Rows[0].Email);
    }

    [Fact]
    public async Task Non_preview_mode_creates_valid_rows_and_reports_errors_for_invalid_ones()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nGood Person,goodperson@example.test,employee,\nBad Person,not-an-email,employee,\nBad Role,badrole@example.test,not_a_role,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal(2, result.ErrorCount);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.NotNull(await db.Users.FirstOrDefaultAsync(u => u.Email == "goodperson@example.test"));
        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == "not-an-email"));
    }

    [Fact]
    public async Task Duplicate_email_within_the_same_csv_is_reported_as_an_error_on_the_second_occurrence()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nFirst,dup@example.test,employee,\nSecond,dup@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));

        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal("duplicate", result.Rows[1].Status);
    }

    [Fact]
    public async Task Preview_reports_a_cross_tenant_email_collision_as_duplicate_not_valid()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _otherCompanyId,
                Email = "shared@example.test",
                Name = "Existing In Other Company",
                PasswordHash = "irrelevant",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // users.email has a GLOBAL unique index (no company_id), so this row -- whose
        // email already belongs to a user in a DIFFERENT company -- must be reported
        // as a duplicate in preview, not "valid". If preview ever again claims this
        // row is importable, the real (non-preview) import will 500 on the unique
        // index and roll back every row in the same request, including GoodPerson.
        var csv = "name,email,role,department\nGood Person,goodperson2@example.test,employee,\nCross Tenant,shared@example.test,employee,";
        var previewResponse = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: true));

        Assert.Equal(HttpStatusCode.OK, previewResponse.StatusCode);
        var previewResult = await previewResponse.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal("valid", previewResult!.Rows[0].Status);
        Assert.Equal("duplicate", previewResult.Rows[1].Status);
        Assert.Equal(1, previewResult.SuccessCount);

        var importResponse = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));
        Assert.Equal(HttpStatusCode.OK, importResponse.StatusCode);
        var importResult = await importResponse.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal("duplicate", importResult!.Rows[1].Status);
        Assert.Equal(1, importResult.SuccessCount);

        using var assertScope = _factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.NotNull(await assertDb.Users.FirstOrDefaultAsync(u => u.Email == "goodperson2@example.test"));
        Assert.Equal(1, await assertDb.Users.CountAsync(u => u.Email == "shared@example.test"));
    }

    [Fact]
    public async Task CompanyAdmin_cannot_bulk_import_a_row_with_company_admin_or_super_admin_role()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\n"
            + "Peer Admin,peeradmin@example.test,company_admin,\n"
            + "Platform Admin,platformadmin@example.test,super_admin,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(0, result!.SuccessCount);
        Assert.Equal(2, result.ErrorCount);
        Assert.Equal("error", result.Rows[0].Status);
        Assert.Equal("error", result.Rows[1].Status);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == "peeradmin@example.test"));
        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == "platformadmin@example.test"));
    }

    [Fact]
    public async Task Employee_cannot_bulk_import_users()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var csv = "name,email,role,department\nSomeone,someone@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: true));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
