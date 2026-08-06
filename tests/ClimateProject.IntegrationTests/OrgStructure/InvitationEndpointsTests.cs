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
    public async Task Employee_direct_invitation_rejects_company_admin_role()
    {
        // Regression test: CompanyAdmin must not be able to mint a peer company_admin
        // account via employee_direct, bypassing the SuperAdmin-only role-change rule.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "wannabe-admin@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.CompanyAdmin));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Shareable_link_rejects_company_admin_role()
    {
        // Regression test: a shareable link must not be usable to self-provision a
        // company_admin account either.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/invitations/shareable-link", new CreateShareableLinkRequest(
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.CompanyAdmin));

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

    [Fact]
    public async Task NonAdmin_cannot_list_or_resend_invitations_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationValidation.TypeEmployeeDirect, "nonadmin-target@invitee.test", _companyAId, null, Roles.Employee));
        var created = await createResponse.Content.ReadFromJsonAsync<InvitationDetail>();

        var employeeToken = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);

        var listResponse = await client.GetAsync($"/admin/invitations?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);

        var resendResponse = await client.PostAsync($"/admin/invitations/{created!.Id}/resend", content: null);
        Assert.Equal(HttpStatusCode.Forbidden, resendResponse.StatusCode);
    }

    [Fact]
    public async Task Supervisor_and_Leader_cannot_list_invitations_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var supervisorToken = await SignUpAndGetTokenAsync(client, Roles.Supervisor, _companyADomain, _companyAId);
        var leaderToken = await SignUpAndGetTokenAsync(client, Roles.Leader, _companyADomain, _companyAId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", supervisorToken);
        var supervisorListResponse = await client.GetAsync($"/admin/invitations?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, supervisorListResponse.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);
        var leaderListResponse = await client.GetAsync($"/admin/invitations?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, leaderListResponse.StatusCode);
    }

    private async Task<Guid> SeedDemographicFieldAsync(Guid companyId, string field, string type, List<string>? options, bool required = false)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var definition = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Field = field,
            Label = field,
            Type = type,
            Options = options,
            Required = required,
            Order = 0,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.DemographicFields.Add(definition);
        await db.SaveChangesAsync();
        return definition.Id;
    }

    [Fact]
    public async Task An_invitation_can_pre_assign_demographics_that_are_stored_normalised()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var fieldId = await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"]);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "preassigned@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee,
            Demographics: new Dictionary<string, string?> { ["work_mode"] = "remote" }));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.Equal("remote", created!.Demographics["work_mode"]);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var row = await db.UserInvitationDemographics.SingleAsync(d => d.InvitationId == created.Id);
        Assert.Equal(fieldId, row.DemographicFieldId);
        Assert.Equal("remote", row.Value);

        var list = await client.GetAsync($"/admin/invitations?companyId={_companyAId}");
        var listed = await list.Content.ReadFromJsonAsync<InvitationListResponse>();
        var listedInvitation = Assert.Single(listed!.Invitations, i => i.Id == created.Id);
        Assert.Equal("remote", listedInvitation.Demographics["work_mode"]);
    }

    [Fact]
    public async Task An_invitation_is_rejected_when_a_pre_assigned_demographic_is_invalid()
    {
        // The reason UserInvitation.Demographics had to go too: this value could
        // previously be written unchecked and only became a problem long after the
        // roster upload that produced it.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"]);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "bad-demographic@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee,
            Demographics: new Dictionary<string, string?> { ["work_mode"] = "hybrid" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.UserInvitations.AnyAsync(i => i.Email == "bad-demographic@invitee.test"));
    }

    [Fact]
    public async Task An_invitation_may_omit_a_required_demographic()
    {
        // Companion to the rejection above: pre-assignment is partial by design --
        // the roster only knows some fields, and the member fills the rest in later.
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"], required: true);

        var response = await client.PostAsJsonAsync("/admin/invitations", new CreateInvitationRequest(
            InvitationType: InvitationValidation.TypeEmployeeDirect,
            Email: "partial-demographic@invitee.test",
            CompanyId: _companyAId,
            DepartmentId: null,
            Role: Roles.Employee,
            Demographics: null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task A_shareable_link_validates_its_pre_assigned_demographics_too()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        await SeedDemographicFieldAsync(_companyAId, "work_mode", "select", ["remote", "onsite"]);

        var rejected = await client.PostAsJsonAsync("/admin/invitations/shareable-link",
            new CreateShareableLinkRequest(_companyAId, null, Roles.Employee, new Dictionary<string, string?> { ["work_mode"] = "hybrid" }));
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);

        var accepted = await client.PostAsJsonAsync("/admin/invitations/shareable-link",
            new CreateShareableLinkRequest(_companyAId, null, Roles.Employee, new Dictionary<string, string?> { ["work_mode"] = "onsite" }));
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        var link = await accepted.Content.ReadFromJsonAsync<InvitationDetail>();
        Assert.Equal("onsite", link!.Demographics["work_mode"]);
    }
}
