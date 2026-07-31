using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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
public class InvitationEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"invitea-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"inviteb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public InvitationEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Invite Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Invite Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task SuperAdmin_can_create_a_company_admin_setup_invitation()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeCompanyAdminSetup,
            Email: "new-admin@invitee.test",
            CompanyId: _companyBId,
            DepartmentId: null,
            Role: Roles.Employee)); // deliberately wrong role -- server must force company_admin

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.Equal(Roles.CompanyAdmin, created!.Role);
        Assert.Equal(InvitationValidation.StatusSent, created.Status);
        Assert.False(string.IsNullOrEmpty(created.Token));
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_a_company_admin_setup_invitation()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeCompanyAdminSetup,
            Email: "new-admin@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.CompanyAdmin));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_can_create_an_employee_direct_invitation_in_their_own_company_only()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var ownCompany = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "employee@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee));
        Assert.Equal(HttpStatusCode.Created, ownCompany.StatusCode);

        var otherCompany = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "employee2@invitee.test",
            CompanyId: _companyBId,
            DepartmentId: null,
            Role: Roles.Employee));
        Assert.Equal(HttpStatusCode.Forbidden, otherCompany.StatusCode);
    }

    [Fact]
    public async Task Employee_direct_invitation_rejects_superadmin_role()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "wannabe@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.SuperAdmin));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Shareable_link_creates_an_invitation_with_no_email()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations/shareable-link", new CreateShareableLinkRequest(
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.Null(created!.Email);
        Assert.Equal(InvitationValidation.TypeEmployeeSelfSignup, created.InvitationType);
    }

    [Fact]
    public async Task Resend_regenerates_the_token_and_extends_expiry()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "resend-me@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee));
        var created = await createResponse.Content.ReadFromJsonAsync<InvitationDetail>();

        var resendResponse = await client.PostAsync($"/admin/invitations/{created!.Id}/resend", content: null);
        Assert.Equal(HttpStatusCode.OK, resendResponse.StatusCode);
        var resent = await resendResponse.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.NotEqual(created.Token, resent!.Token);
        Assert.Equal(1, resent.ReminderCount);
    }

    [Fact]
    public async Task List_returns_invitations_scoped_to_the_callers_company()
    {
        var client = _factory.CreateClient();
        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationValidation.TypeEmployeeDirect, "listme@invitee.test", _companyAId, null, Roles.Employee));

        var listResponse = await client.GetAsync($"/admin/invitations?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<InvitationListResponse>();
        Assert.Contains(list!.Invitations, i => i.Email == "listme@invitee.test");

        var otherCompanyList = await client.GetAsync($"/admin/invitations?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, otherCompanyList.StatusCode);
    }
}
