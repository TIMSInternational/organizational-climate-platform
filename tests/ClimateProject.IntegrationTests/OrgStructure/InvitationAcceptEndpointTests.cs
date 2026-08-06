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
public class InvitationAcceptEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"accept-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public InvitationAcceptEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Accept Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<UserInvitation> CreateDirectInvitationAsync(string email, string? expiresOverride = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        // Create an inviting user first
        var invitingUser = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Email = $"inviter-{Guid.NewGuid():N}@{_companyDomain}",
            Name = "Inviter",
            PasswordHash = "dummy",
            Role = Roles.CompanyAdmin,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(invitingUser);
        await db.SaveChangesAsync();

        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = email,
            CompanyId = _companyId,
            InvitedBy = invitingUser.Id,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = InvitationValidation.TypeEmployeeDirect,
            Role = Roles.Employee,
            Status = InvitationValidation.StatusSent,
            ExpiresAt = expiresOverride is null ? DateTimeOffset.UtcNow.AddDays(7) : DateTimeOffset.UtcNow.AddDays(-1),
            SentAt = DateTimeOffset.UtcNow,
            ReminderCount = 0,
        };
        db.UserInvitations.Add(invitation);
        await db.SaveChangesAsync();
        return invitation;
    }

    [Fact]
    public async Task Accepting_a_direct_invitation_creates_an_active_user_and_returns_a_token()
    {
        var invitation = await CreateDirectInvitationAsync("directinvitee@example.test");
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "Direct Invitee", Password: "a-good-password"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var token = (await response.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        Assert.False(string.IsNullOrEmpty(token));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == "directinvitee@example.test");
        Assert.NotNull(user);
        Assert.Equal(_companyId, user!.CompanyId);
        Assert.True(user.IsActive);

        var reloaded = await db.UserInvitations.FirstAsync(i => i.Id == invitation.Id);
        Assert.Equal(InvitationValidation.StatusAccepted, reloaded.Status);
    }

    [Fact]
    public async Task Accepting_an_expired_invitation_fails()
    {
        var invitation = await CreateDirectInvitationAsync("expired@example.test", expiresOverride: "expired");
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "Too Late", Password: "a-good-password"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Accepting_an_already_accepted_invitation_fails()
    {
        var invitation = await CreateDirectInvitationAsync("twice@example.test");
        var client = _factory.CreateClient();

        var first = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "First Try", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "Second Try", Password: "another-password"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Accepting_an_unknown_token_returns_404()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync(
            "/invitations/not-a-real-token/accept",
            new AcceptInvitationRequest(Email: null, Name: "Nobody", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Accepting_a_shareable_link_requires_an_email_matching_the_companys_domain()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

            // Create an inviting user first
            var invitingUser = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"inviter-{Guid.NewGuid():N}@{_companyDomain}",
                Name = "Inviter",
                PasswordHash = "dummy",
                Role = Roles.CompanyAdmin,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(invitingUser);
            await db.SaveChangesAsync();

            db.UserInvitations.Add(new UserInvitation
            {
                Id = Guid.NewGuid(),
                Email = null,
                CompanyId = _companyId,
                InvitedBy = invitingUser.Id,
                InvitationToken = "shareable-token-1",
                InvitationType = InvitationValidation.TypeEmployeeSelfSignup,
                Role = Roles.Employee,
                Status = InvitationValidation.StatusSent,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
                SentAt = DateTimeOffset.UtcNow,
                ReminderCount = 0,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();

        var wrongDomain = await client.PostAsJsonAsync(
            "/invitations/shareable-token-1/accept",
            new AcceptInvitationRequest(Email: $"someone@not-{_companyDomain}", Name: "Wrong Domain", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.BadRequest, wrongDomain.StatusCode);

        var rightDomain = await client.PostAsJsonAsync(
            "/invitations/shareable-token-1/accept",
            new AcceptInvitationRequest(Email: $"someone@{_companyDomain}", Name: "Right Domain", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, rightDomain.StatusCode);
    }

    [Fact]
    public async Task Accepting_a_shareable_link_rejects_a_malformed_email()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var invitingUser = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"inviter-{Guid.NewGuid():N}@{_companyDomain}",
                Name = "Inviter",
                PasswordHash = "dummy",
                Role = Roles.CompanyAdmin,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(invitingUser);
            await db.SaveChangesAsync();

            db.UserInvitations.Add(new UserInvitation
            {
                Id = Guid.NewGuid(),
                Email = null,
                CompanyId = _companyId,
                InvitedBy = invitingUser.Id,
                InvitationToken = "shareable-token-malformed",
                InvitationType = InvitationValidation.TypeEmployeeSelfSignup,
                Role = Roles.Employee,
                Status = InvitationValidation.StatusSent,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
                SentAt = DateTimeOffset.UtcNow,
                ReminderCount = 0,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();

        // No '@' at all -- the old `Contains('@') ? ... : string.Empty` fallback would
        // have computed domain == "" and, for a company with a non-null EmailDomain,
        // still correctly rejected this. This test guards the regex-based validation
        // directly rather than relying on that side effect.
        var response = await client.PostAsJsonAsync(
            "/invitations/shareable-token-malformed/accept",
            new AcceptInvitationRequest(Email: "not-an-email", Name: "Bad Email", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Accepting_a_shareable_link_rejects_any_email_when_the_company_has_no_email_domain_configured()
    {
        // Regression test: a company row with a NULL EmailDomain must not bypass the
        // domain check entirely. No current API path creates such a company, but this
        // proves the endpoint itself doesn't rely on that invariant.
        Guid noDomainCompanyId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var noDomainCompany = new Company { Id = Guid.NewGuid(), Name = "No Domain Co", EmailDomain = null, CreatedAt = DateTimeOffset.UtcNow };
            db.Companies.Add(noDomainCompany);
            noDomainCompanyId = noDomainCompany.Id;

            var invitingUser = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = noDomainCompanyId,
                Email = $"inviter-{Guid.NewGuid():N}@{_companyDomain}",
                Name = "Inviter",
                PasswordHash = "dummy",
                Role = Roles.SuperAdmin,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(invitingUser);
            await db.SaveChangesAsync();

            db.UserInvitations.Add(new UserInvitation
            {
                Id = Guid.NewGuid(),
                Email = null,
                CompanyId = noDomainCompanyId,
                InvitedBy = invitingUser.Id,
                InvitationToken = "shareable-token-no-domain",
                InvitationType = InvitationValidation.TypeEmployeeSelfSignup,
                Role = Roles.Employee,
                Status = InvitationValidation.StatusSent,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
                SentAt = DateTimeOffset.UtcNow,
                ReminderCount = 0,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/invitations/shareable-token-no-domain/accept",
            new AcceptInvitationRequest(Email: "literally-anything@example.test", Name: "Anyone", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Accepting_an_invitation_carries_its_pre_assigned_demographics_onto_the_new_user()
    {
        var invitation = await CreateDirectInvitationAsync("carryover@example.test");

        Guid fieldId;
        using (var seedScope = _factory.Services.CreateScope())
        {
            var seedDb = seedScope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var now = DateTimeOffset.UtcNow;
            var field = new DemographicField
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Field = "work_mode",
                Label = "Work mode",
                Type = "select",
                Options = ["remote", "onsite"],
                Required = false,
                Order = 0,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            seedDb.DemographicFields.Add(field);
            seedDb.UserInvitationDemographics.Add(new UserInvitationDemographic
            {
                InvitationId = invitation.Id,
                DemographicFieldId = field.Id,
                Value = "remote",
            });
            await seedDb.SaveChangesAsync();
            fieldId = field.Id;
        }

        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync(
            $"/invitations/{invitation.InvitationToken}/accept",
            new AcceptInvitationRequest(Email: null, Name: "Carry Over", Password: "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == "carryover@example.test");
        var carried = await db.UserDemographics.SingleAsync(d => d.UserId == user.Id);
        Assert.Equal(fieldId, carried.DemographicFieldId);
        Assert.Equal("remote", carried.Value);
    }
}
