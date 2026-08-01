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
    private Guid _companyId;

    public BulkImportEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Bulk Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
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
