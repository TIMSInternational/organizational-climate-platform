using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// <c>PUT /admin/users/{id}</c> with an <c>email</c>: correcting a person's address (audit
/// gap G3). ESPH sent a nonexistent address and full mailboxes and nothing in the product could
/// change either.
/// </summary>
[Collection("Postgres")]
public class UserEmailChangeTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public UserEmailChangeTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"uec-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Email Change Co");
        _otherCompanyId = await _harness.SeedCompanyAsync("Email Change Other Co");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // Not a reserved domain: the endpoint refuses those (UndeliverableAddresses). Nothing is
    // mailed by this route, so no message ever goes here.
    private static string RealAddress(string local = "") => $"{local}{Guid.NewGuid():N}@climate-email-change.org";

    private Task<Guid> SeedUserAsync(Guid companyId, string role = Roles.Employee, string? email = null)
        => _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Email = email ?? RealAddress(),
                Name = "Person",
                Role = role,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user.Id;
        });

    private Task<User> ReadUserAsync(Guid id)
        => _harness.WithDbAsync(db => db.Users.AsNoTracking().FirstAsync(u => u.Id == id));

    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static Task<HttpResponseMessage> PutEmailAsync(HttpClient client, Guid id, string? email)
        => client.PutAsJsonAsync($"/admin/users/{id}", new UpdateUserRequest(null, null, null, null, null, email));

    [Fact]
    public async Task A_company_admin_corrects_an_employees_address_and_it_is_trimmed_lowercased_audited_and_ends_their_sessions()
    {
        var (admin, adminId) = await _harness.IdentifiedClientAsync(Roles.CompanyAdmin, _companyId);
        var employeeId = await SeedUserAsync(_companyId);
        var before = await ReadUserAsync(employeeId);
        var wanted = RealAddress("Corrected.");

        var response = await PutEmailAsync(admin, employeeId, $"  {wanted.ToUpperInvariant()}  ");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<UserDetail>())!;
        Assert.Equal(wanted.ToLowerInvariant(), detail.Email);
        Assert.NotNull(detail.EmailChange);
        Assert.Equal(before.Email, detail.EmailChange!.PreviousEmail);

        var after = await ReadUserAsync(employeeId);
        Assert.Equal(wanted.ToLowerInvariant(), after.Email);
        Assert.NotEqual(before.SecurityStamp, after.SecurityStamp);

        var changes = await _harness.WithDbAsync(async db =>
        {
            var row = await db.AuditLogs.AsNoTracking()
                .Where(a => a.UserId == adminId && a.ResourceId == employeeId.ToString())
                .OrderByDescending(a => a.Timestamp)
                .FirstAsync();
            return JsonDocument.Parse(row.Details!).RootElement.GetProperty("Changes").Clone();
        });
        Assert.Equal(before.Email, changes.GetProperty("email").GetProperty("Before").GetString());
        Assert.Equal(wanted.ToLowerInvariant(), changes.GetProperty("email").GetProperty("After").GetString());
    }

    [Fact]
    public async Task An_address_held_by_anyone_on_the_platform_is_a_409_and_nothing_changes()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var employeeId = await SeedUserAsync(_companyId);
        var before = await ReadUserAsync(employeeId);
        var takenElsewhere = RealAddress();
        await SeedUserAsync(_otherCompanyId, email: takenElsewhere);

        var response = await admin.PutAsJsonAsync(
            $"/admin/users/{employeeId}",
            new UpdateUserRequest("Renamed too", null, null, null, null, $" {takenElsewhere.ToUpperInvariant()} "));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("email_taken", await CodeOf(response));
        var after = await ReadUserAsync(employeeId);
        Assert.Equal(before.Email, after.Email);
        Assert.Equal(before.Name, after.Name);
        Assert.Equal(before.SecurityStamp, after.SecurityStamp);
    }

    [Fact]
    public async Task An_address_held_by_a_pending_invitation_is_a_409()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var employeeId = await SeedUserAsync(_companyId);
        var invited = RealAddress();
        await _harness.WithDbAsync(async db =>
        {
            var inviter = await db.Users.Where(u => u.CompanyId == _companyId).Select(u => u.Id).FirstAsync();
            db.UserInvitations.Add(new UserInvitation
            {
                Id = Guid.NewGuid(),
                Email = invited,
                CompanyId = _otherCompanyId,
                InvitedBy = inviter,
                InvitationToken = Guid.NewGuid().ToString("N"),
                InvitationType = InvitationValidation.TypeEmployeeDirect,
                Role = Roles.Employee,
                Status = InvitationValidation.StatusSent,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            });
            await db.SaveChangesAsync();
        });

        var response = await PutEmailAsync(admin, employeeId, invited);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("email_invited", await CodeOf(response));
    }

    [Theory]
    [InlineData("not-an-address", "email_invalid")]
    [InlineData("two words@climate-email-change.org", "email_invalid")]
    [InlineData("nodot@localhost", "email_invalid")]
    [InlineData("   ", "email_invalid")]
    [InlineData("someone@acme.test", "email_undeliverable")]
    [InlineData("someone@example.com", "email_undeliverable")]
    public async Task A_malformed_or_undeliverable_address_is_a_400_and_nothing_changes(string email, string code)
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var employeeId = await SeedUserAsync(_companyId);
        var before = await ReadUserAsync(employeeId);

        var response = await PutEmailAsync(admin, employeeId, email);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(code, await CodeOf(response));
        Assert.Equal(before.Email, (await ReadUserAsync(employeeId)).Email);
    }

    [Fact]
    public async Task A_company_admin_cannot_change_an_address_in_another_company()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var foreignId = await SeedUserAsync(_otherCompanyId);
        var before = await ReadUserAsync(foreignId);

        var response = await PutEmailAsync(admin, foreignId, RealAddress());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(before.Email, (await ReadUserAsync(foreignId)).Email);
    }

    [Theory]
    [InlineData(Roles.CompanyAdmin)]
    [InlineData(Roles.SuperAdmin)]
    public async Task A_company_admin_cannot_repoint_an_admin_accounts_address_but_a_super_admin_can(string targetRole)
    {
        var companyAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var targetId = await SeedUserAsync(_companyId, targetRole);
        var before = await ReadUserAsync(targetId);

        var refused = await PutEmailAsync(companyAdmin, targetId, RealAddress());
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal(before.Email, (await ReadUserAsync(targetId)).Email);

        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, _companyId);
        var allowed = await PutEmailAsync(superAdmin, targetId, RealAddress());
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task No_email_or_the_same_email_changes_nothing_and_reports_no_change()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var employeeId = await SeedUserAsync(_companyId);
        var before = await ReadUserAsync(employeeId);

        var omitted = await admin.PutAsJsonAsync($"/admin/users/{employeeId}", new UpdateUserRequest("New name", null, null, true));
        Assert.Equal(HttpStatusCode.OK, omitted.StatusCode);
        Assert.Null((await omitted.Content.ReadFromJsonAsync<UserDetail>())!.EmailChange);

        // The same address, as an edit panel re-submits it: not a change, so not a conflict
        // with the person themselves and no sign-out.
        var same = await PutEmailAsync(admin, employeeId, $" {before.Email.ToUpperInvariant()} ");
        Assert.Equal(HttpStatusCode.OK, same.StatusCode);
        Assert.Null((await same.Content.ReadFromJsonAsync<UserDetail>())!.EmailChange);

        var after = await ReadUserAsync(employeeId);
        Assert.Equal(before.Email, after.Email);
        Assert.Equal("New name", after.Name);
        Assert.Equal(before.SecurityStamp, after.SecurityStamp);
    }

    [Fact]
    public async Task The_response_counts_only_unused_codes_on_scheduled_or_active_surveys_and_expires_invitations_to_the_old_address()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var oldAddress = RealAddress();
        var employeeId = await SeedUserAsync(_companyId, email: oldAddress);

        async Task<Guid> SurveyAsync(string status)
        {
            var created = await SurveyTestHarness.CreateSurveyAsync(
                admin, SurveyTestHarness.MinimalRequest(_companyId, title: LocalizedInput.FromBare($"Codes {status}")));
            await _harness.ForceStatusAsync(created.Id, status);
            return created.Id;
        }

        var active = await SurveyAsync(SurveyStatuses.Active);
        var scheduled = await SurveyAsync(SurveyStatuses.Scheduled);
        var activeButUsed = await SurveyAsync(SurveyStatuses.Active);
        var closed = await SurveyAsync(SurveyStatuses.Closed);
        var draft = await SurveyAsync(SurveyStatuses.Draft);

        var pendingInvitationId = Guid.NewGuid();
        var acceptedInvitationId = Guid.NewGuid();
        await _harness.WithDbAsync(async db =>
        {
            void Credential(Guid surveyId, DateTimeOffset? lastSignInAt) => db.SurveyCredentials.Add(new SurveyCredential
            {
                SurveyId = surveyId,
                UserId = employeeId,
                Username = $"uec-{Guid.NewGuid():N}"[..20],
                PasswordHash = "not-a-real-hash",
                CreatedAt = DateTimeOffset.UtcNow,
                LastSignInAt = lastSignInAt,
            });

            Credential(active, null);
            Credential(scheduled, null);
            Credential(activeButUsed, DateTimeOffset.UtcNow);
            Credential(closed, null);
            Credential(draft, null);

            UserInvitation Invitation(Guid id, DateTimeOffset? acceptedAt) => new()
            {
                Id = id,
                Email = oldAddress,
                CompanyId = _companyId,
                InvitedBy = employeeId,
                InvitationToken = Guid.NewGuid().ToString("N"),
                InvitationType = InvitationValidation.TypeEmployeeDirect,
                Role = Roles.Employee,
                Status = acceptedAt is null ? InvitationValidation.StatusSent : InvitationValidation.StatusAccepted,
                AcceptedAt = acceptedAt,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            };
            db.UserInvitations.Add(Invitation(pendingInvitationId, null));
            db.UserInvitations.Add(Invitation(acceptedInvitationId, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        });

        var response = await PutEmailAsync(admin, employeeId, RealAddress());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var change = (await response.Content.ReadFromJsonAsync<UserDetail>())!.EmailChange!;
        Assert.Equal(2, change.UnusedSurveyCodes);
        Assert.Equal(1, change.PendingInvitationsExpired);

        var (pending, accepted) = await _harness.WithDbAsync(async db => (
            await db.UserInvitations.AsNoTracking().FirstAsync(i => i.Id == pendingInvitationId),
            await db.UserInvitations.AsNoTracking().FirstAsync(i => i.Id == acceptedInvitationId)));
        Assert.True(pending.ExpiresAt <= DateTimeOffset.UtcNow);
        Assert.True(accepted.ExpiresAt > DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task A_session_minted_before_the_change_is_refused_afterwards()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var (employeeToken, employeeId) = await _harness.IdentifiedTokenAsync(Roles.Employee, _companyId);
        var employee = _harness.Factory.CreateClient();
        employee.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);
        Assert.Equal(HttpStatusCode.OK, (await employee.GetAsync("/profile")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await PutEmailAsync(admin, employeeId, RealAddress())).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await employee.GetAsync("/profile")).StatusCode);
    }
}
