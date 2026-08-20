using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.OrgStructure;

[Collection("Postgres")]
public class BulkImportEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _postgresConnectionString;
    private readonly string _companyDomain = $"bulk-{Guid.NewGuid():N}.test";
    private readonly string _otherCompanyDomain = $"bulk-other-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;

    public BulkImportEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _postgresConnectionString = postgres.ConnectionString;
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

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, AuthWebApplicationFactory? factory = null)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test Admin", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = (factory ?? _factory).Services.CreateScope();
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
        // An invitation, not an account: the row is reachable by the person it names.
        Assert.NotNull(await db.UserInvitations.FirstOrDefaultAsync(i => i.Email == "goodperson@example.test"));
        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == "goodperson@example.test"));
        Assert.Null(await db.UserInvitations.FirstOrDefaultAsync(i => i.Email == "not-an-email"));
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
        Assert.NotNull(await assertDb.UserInvitations.FirstOrDefaultAsync(i => i.Email == "goodperson2@example.test"));
        // The cross-tenant collision still resolves to exactly one account and no second
        // invitation racing it.
        Assert.Equal(1, await assertDb.Users.CountAsync(u => u.Email == "shared@example.test"));
        Assert.Equal(0, await assertDb.UserInvitations.CountAsync(i => i.Email == "shared@example.test"));
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

    /// <summary>
    /// The criterion #372 exists for, end to end. This test could not have been written before
    /// the change: the import wrote a User whose PasswordHash was a freshly generated Guid that
    /// was then discarded, so there was nothing to accept and no credential to sign in with.
    /// </summary>
    [Fact]
    public async Task A_bulk_imported_person_can_accept_their_invitation_and_sign_in()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var email = $"invitee-{Guid.NewGuid():N}@example.test";
        var csv = $"name,email,role,department\nAna Funcionaria,{email},employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        string invitationToken;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var invitation = await db.UserInvitations.FirstAsync(i => i.Email == email);
            invitationToken = invitation.InvitationToken;
            Assert.Equal(Roles.Employee, invitation.Role);
            Assert.Equal(_companyId, invitation.CompanyId);

            // No account yet, and that is the point: an account exists once its owner makes it.
            Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Email == email));
        }

        var anonymous = _factory.CreateClient();
        var accept = await anonymous.PostAsJsonAsync(
            $"/invitations/{invitationToken}/accept",
            new { name = "Ana Funcionaria", password = "her-own-password" });
        Assert.Equal(HttpStatusCode.Created, accept.StatusCode);

        // The proof. Signing in with a credential she chose is exactly what the discarded-Guid
        // account made impossible for every person a CSV ever named.
        var login = await anonymous.PostAsJsonAsync("/auth/login", new LoginRequest(email, "her-own-password"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace((await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token));
    }

    /// <summary>
    /// The regression this change exists to prevent, asserted as a negative so that
    /// reintroducing the account-writing branch fails here rather than in production.
    /// </summary>
    [Fact]
    public async Task Import_creates_no_account_holding_a_credential_nobody_has()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var email = $"unreachable-{Guid.NewGuid():N}@example.test";
        var csv = $"name,email,role,department\nSomebody,{email},employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));

        var result = await response.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal(1, result!.SuccessCount);
        Assert.Equal("invited", result.Rows[0].Status);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(0, await db.Users.CountAsync(u => u.Email == email));
        Assert.Equal(1, await db.UserInvitations.CountAsync(i => i.Email == email));
    }

    /// <summary>
    /// Re-uploading last week's spreadsheet is the normal way an admin uses this endpoint, and
    /// a second live token is not a harmless duplicate: whichever the person redeems first makes
    /// the other permanently unredeemable, and nothing in either mail says which is which.
    /// </summary>
    [Fact]
    public async Task Re_importing_somebody_who_already_holds_a_live_invitation_mints_no_second_token()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var email = $"twice-{Guid.NewGuid():N}@example.test";
        var csv = $"name,email,role,department\nRepeated Person,{email},employee,";

        var first = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));
        Assert.Equal("invited", (await first.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows[0].Status);

        var second = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));
        var secondResult = await second.Content.ReadFromJsonAsync<BulkImportResponse>();
        Assert.Equal("duplicate", secondResult!.Rows[0].Status);
        Assert.Equal(0, secondResult.SuccessCount);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(1, await db.UserInvitations.CountAsync(i => i.Email == email));
    }

    /// <summary>
    /// Without this, deleting the delivery loop from the endpoint is invisible: the invitations
    /// are still committed, the response still says "invited", and nothing ever reaches anybody.
    /// A sender that actually delivers is required to see the promotion at all, because the
    /// default registration in tests does not deliver.
    /// </summary>
    [Fact]
    public async Task An_imported_invitation_is_mailed_and_only_then_recorded_as_sent()
    {
        await using var factory = new DeliveringSenderFactory(_postgresConnectionString);
        var client = factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, factory);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var email = $"mailed-{Guid.NewGuid():N}@example.test";
        var csv = $"name,email,role,department\nMailed Person,{email},employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var invitation = await db.UserInvitations.FirstAsync(i => i.Email == email);

        // #368's rule, inherited rather than reimplemented: `sent` means a provider took it.
        Assert.Equal(InvitationValidation.StatusSent, invitation.Status);
        Assert.NotNull(invitation.SentAt);
    }

    /// <summary>
    /// An invited person is not yet a member. `CompanyEndpoints` counts active users to report
    /// a company's size, and every other denominator drawn from `users` inherits that. When the
    /// import wrote accounts directly, uploading a spreadsheet grew the company by people who
    /// had not been reached, could not sign in, and would never answer anything -- which is the
    /// denominator every response rate is divided by.
    /// </summary>
    [Fact]
    public async Task An_invitee_does_not_count_as_a_member_until_they_accept()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        int before;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            before = await db.Users.CountAsync(u => u.CompanyId == _companyId && u.IsActive);
        }

        var csv = $"name,email,role,department\nOne,{Guid.NewGuid():N}@example.test,employee,\nTwo,{Guid.NewGuid():N}@example.test,employee,";
        var response = await client.PostAsync("/admin/users/bulk-import", BuildForm(csv, _companyId, preview: false));
        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<BulkImportResponse>())!.SuccessCount);

        using var after = _factory.Services.CreateScope();
        var afterDb = after.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(before, await afterDb.Users.CountAsync(u => u.CompanyId == _companyId && u.IsActive));
        Assert.Equal(2, await afterDb.UserInvitations.CountAsync(i => i.CompanyId == _companyId && i.AcceptedAt == null));
    }

    /// <summary>A sender that delivers, so the promotion path can be exercised at all.</summary>
    private sealed class DeliveringInvitationEmailSender : IInvitationEmailSender
    {
        public Task<EmailSendOutcome> SendAsync(UserInvitation invitation, CancellationToken cancellationToken)
            => Task.FromResult(EmailSendOutcome.Success());
    }

    private sealed class DeliveringSenderFactory(string connectionString)
        : AuthWebApplicationFactory(connectionString)
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IInvitationEmailSender>();
                services.AddScoped<IInvitationEmailSender>(_ => new DeliveringInvitationEmailSender());
            });
        }
    }
}
