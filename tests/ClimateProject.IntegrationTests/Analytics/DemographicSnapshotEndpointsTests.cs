using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Analytics;

[Collection("Postgres")]
public class DemographicSnapshotEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"snapa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"snapb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _surveyAId;
    private Guid _surveyBId;
    private Guid _departmentAId;
    private Guid _workModeFieldId;

    public DemographicSnapshotEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;

        var companyA = new Company { Id = Guid.NewGuid(), Name = "Snap Co A", EmailDomain = _companyADomain, CreatedAt = now };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Snap Co B", EmailDomain = _companyBDomain, CreatedAt = now };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();

        var department = new Department
        {
            Id = Guid.NewGuid(), CompanyId = companyA.Id, Name = "Engineering", CreatedAt = now, UpdatedAt = now,
        };
        db.Departments.Add(department);
        _departmentAId = department.Id;

        var workMode = new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = companyA.Id, Field = "work_mode", LabelEn = "Work mode",
            Type = "select", Required = false, Order = 0, IsActive = true, CreatedAt = now, UpdatedAt = now,
        };
        db.DemographicFields.Add(workMode);
        DemographicOptionSeed.Add(db, workMode.Id, ["remote", "onsite"]);
        _workModeFieldId = workMode.Id;

        var tenure = new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = companyA.Id, Field = "tenure", LabelEn = "Tenure",
            Type = "select", Required = false, Order = 1, IsActive = true, CreatedAt = now, UpdatedAt = now,
        };
        db.DemographicFields.Add(tenure);
        DemographicOptionSeed.Add(db, tenure.Id, ["0-1 years", "1-2 years"]);
        await db.SaveChangesAsync();

        var authorA = await SeedUserAsync(db, companyA.Id, "employee");
        var authorB = await SeedUserAsync(db, companyB.Id, "employee");

        _surveyAId = await SeedSurveyAsync(db, companyA.Id, authorA);
        _surveyBId = await SeedSurveyAsync(db, companyB.Id, authorB);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<Guid> SeedSurveyAsync(ClimateProjectDbContext db, Guid companyId, Guid createdBy)
    {
        var now = DateTimeOffset.UtcNow;
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEn = "Annual climate survey",
            Language = "en",
            Type = "general_climate",
            StartDate = now,
            EndDate = now.AddDays(14),
            Status = "draft",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return survey.Id;
    }

    private static async Task<Guid> SeedUserAsync(
        ClimateProjectDbContext db,
        Guid? companyId,
        string role,
        Guid? departmentId = null)
    {
        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Email = $"member-{Guid.NewGuid():N}@member.test",
            Name = "Member",
            Role = role,
            DepartmentId = departmentId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid? companyId = null)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }

            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private async Task<HttpClient> AdminClientAsync(Guid companyId, string domain)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, domain, companyId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<DemographicSnapshotDetail> CreateSnapshotAsync(HttpClient client, Guid surveyId, Guid companyId, string reason)
    {
        var response = await client.PostAsJsonAsync(
            "/admin/demographic-snapshots", new CreateDemographicSnapshotRequest(surveyId, companyId, reason));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DemographicSnapshotDetail>())!;
    }

    private static AddSnapshotEntryRequest Entry(Guid userId, Dictionary<string, string?>? demographics = null)
        => new(userId, null, null, null, null, null, null, demographics);

    [Fact]
    public async Task Creating_a_snapshot_assigns_the_next_version_for_the_survey()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);

        var first = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");
        var second = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Mid-cycle");

        Assert.Equal(1, first.Version);
        Assert.Equal(2, second.Version);
        Assert.True(second.IsActive);
        Assert.Equal(DemographicSnapshotPrivacy.MinimumGroupSize, second.MinimumGroupSize);
    }

    [Fact]
    public async Task A_snapshot_cannot_be_filed_against_another_companys_survey()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);

        var response = await client.PostAsJsonAsync(
            "/admin/demographic-snapshots", new CreateDemographicSnapshotRequest(_surveyBId, _companyAId, "Cross tenant"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_company_admin_cannot_read_another_companys_snapshot()
    {
        var ownerClient = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(ownerClient, _surveyAId, _companyAId, "Launch");

        var otherClient = await AdminClientAsync(_companyBId, _companyBDomain);
        var response = await otherClient.GetAsync($"/admin/demographic-snapshots/{snapshot.Id}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_super_admin_can_read_any_companys_snapshot()
    {
        var ownerClient = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(ownerClient, _surveyAId, _companyAId, "Launch");

        var superClient = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(superClient, Roles.SuperAdmin, _companyBDomain, _companyBId);
        superClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await superClient.GetAsync($"/admin/demographic-snapshots/{snapshot.Id}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task An_entry_derives_department_role_and_demographics_from_the_live_record()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        Guid memberId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            memberId = await SeedUserAsync(db, _companyAId, "leader", _departmentAId);
            db.UserDemographics.Add(new UserDemographic
            {
                UserId = memberId,
                DemographicFieldId = _workModeFieldId,
                Value = "remote",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var response = await client.PostAsJsonAsync($"/admin/demographic-snapshots/{snapshot.Id}/entries", Entry(memberId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<DemographicSnapshotDetail>())!;

        var entry = Assert.Single(detail.Entries);
        Assert.Equal("Engineering", entry.Department);
        Assert.Equal("leader", entry.Role);
        Assert.Equal(SnapshotEntryValues.Unspecified, entry.Tenure);
        Assert.Equal("remote", entry.Demographics["work_mode"]);
        Assert.Equal(1, detail.TotalUsers);
        Assert.Equal(1, detail.DepartmentsCount);
    }

    [Fact]
    public async Task A_demographic_value_outside_the_configured_options_is_rejected()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        Guid memberId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            memberId = await SeedUserAsync(db, _companyAId, "employee", _departmentAId);
        }

        var response = await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{snapshot.Id}/entries",
            Entry(memberId, new Dictionary<string, string?> { ["work_mode"] = "hybrid" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_user_from_another_company_cannot_be_added_to_a_snapshot()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        Guid outsiderId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            outsiderId = await SeedUserAsync(db, _companyBId, "employee");
        }

        var response = await client.PostAsJsonAsync($"/admin/demographic-snapshots/{snapshot.Id}/entries", Entry(outsiderId));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_global_scoped_user_cannot_be_added_to_a_snapshot()
    {
        // User.CompanyId is Guid? since #191 and NULL means global scope. A global user is
        // in no company's headcount, so NULL must not be treated as a match.
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        Guid globalUserId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            globalUserId = await SeedUserAsync(db, null, Roles.SuperAdmin);
        }

        var response = await client.PostAsJsonAsync($"/admin/demographic-snapshots/{snapshot.Id}/entries", Entry(globalUserId));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task The_same_user_cannot_be_entered_twice_into_one_snapshot()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        Guid memberId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            memberId = await SeedUserAsync(db, _companyAId, "employee", _departmentAId);
        }

        var first = await client.PostAsJsonAsync($"/admin/demographic-snapshots/{snapshot.Id}/entries", Entry(memberId));
        var second = await client.PostAsJsonAsync($"/admin/demographic-snapshots/{snapshot.Id}/entries", Entry(memberId));

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Small_groups_are_suppressed_from_the_distributions_but_still_counted()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        var members = new List<Guid>();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            for (var i = 0; i < DemographicSnapshotPrivacy.MinimumGroupSize + 1; i++)
            {
                members.Add(await SeedUserAsync(db, _companyAId, "employee", _departmentAId));
            }
        }

        // Everyone is remote except one person -- the group of one that must not be published.
        for (var i = 0; i < members.Count; i++)
        {
            var mode = i == 0 ? "onsite" : "remote";
            var response = await client.PostAsJsonAsync(
                $"/admin/demographic-snapshots/{snapshot.Id}/entries",
                Entry(members[i], new Dictionary<string, string?> { ["work_mode"] = mode }));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        var detail = (await client.GetFromJsonAsync<DemographicSnapshotDetail>(
            $"/admin/demographic-snapshots/{snapshot.Id}"))!;

        var workMode = detail.Distributions.Single(d => d.Field == "work_mode");
        Assert.Equal(["remote"], workMode.Buckets.Select(b => b.Value));
        Assert.Equal(1, workMode.SuppressedGroupCount);
        Assert.Equal(1, workMode.SuppressedPeopleCount);
        Assert.Equal(members.Count, detail.TotalUsers);
    }

    [Fact]
    public async Task A_change_whose_values_are_not_json_is_rejected_rather_than_500ing()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        var response = await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{snapshot.Id}/changes",
            new AddSnapshotChangeRequest("department", "Sales", "Engineering", "Reassignment"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_manual_change_may_not_claim_the_computed_reason_prefix()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        var response = await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{snapshot.Id}/changes",
            new AddSnapshotChangeRequest("department", "\"Sales\"", "\"Engineering\"", "computed:v1"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_manual_change_is_recorded_and_marked_as_not_computed()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        var response = await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{snapshot.Id}/changes",
            new AddSnapshotChangeRequest("department", "\"Sales\"", "\"Engineering\"", "Reorg"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<DemographicSnapshotDetail>())!;
        var change = Assert.Single(detail.Changes);
        Assert.False(change.IsComputed);
        Assert.Equal("\"Engineering\"", change.NewValue);
    }

    [Fact]
    public async Task Recompute_diffs_against_the_prior_version_and_leaves_manual_changes_alone()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);

        Guid stayer;
        Guid leaver;
        Guid joiner;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            stayer = await SeedUserAsync(db, _companyAId, "employee", _departmentAId);
            leaver = await SeedUserAsync(db, _companyAId, "employee", _departmentAId);
            joiner = await SeedUserAsync(db, _companyAId, "employee", _departmentAId);
        }

        var v1 = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");
        foreach (var userId in new[] { stayer, leaver })
        {
            var added = await client.PostAsJsonAsync(
                $"/admin/demographic-snapshots/{v1.Id}/entries",
                Entry(userId, new Dictionary<string, string?> { ["work_mode"] = "onsite" }));
            Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        }

        var v2 = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Close");
        var stayerAdded = await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{v2.Id}/entries",
            Entry(stayer, new Dictionary<string, string?> { ["work_mode"] = "remote" }));
        Assert.Equal(HttpStatusCode.Created, stayerAdded.StatusCode);
        var joinerAdded = await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{v2.Id}/entries",
            Entry(joiner, new Dictionary<string, string?> { ["work_mode"] = "remote" }));
        Assert.Equal(HttpStatusCode.Created, joinerAdded.StatusCode);

        var manual = await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{v2.Id}/changes",
            new AddSnapshotChangeRequest("note", null, "\"headcount frozen\"", "Context"));
        Assert.Equal(HttpStatusCode.Created, manual.StatusCode);

        var recompute = await client.PostAsync($"/admin/demographic-snapshots/{v2.Id}/changes/recompute", null);
        Assert.Equal(HttpStatusCode.OK, recompute.StatusCode);
        var result = (await recompute.Content.ReadFromJsonAsync<RecomputeSnapshotChangesResponse>())!;

        Assert.Equal(1, result.PriorVersion);
        Assert.Equal(3, result.ComputedCount);

        var computed = result.Snapshot.Changes.Where(c => c.IsComputed).ToList();
        Assert.Contains(computed, c => c.Field == $"{stayer}.work_mode" && c.OldValue == "\"onsite\"" && c.NewValue == "\"remote\"");
        Assert.Contains(computed, c => c.Field == $"{leaver}.{DemographicSnapshotDiff.MembershipField}" && c.NewValue is null);
        Assert.Contains(computed, c => c.Field == $"{joiner}.{DemographicSnapshotDiff.MembershipField}" && c.OldValue is null);
        Assert.Single(result.Snapshot.Changes, c => !c.IsComputed);
    }

    [Fact]
    public async Task Recompute_is_idempotent()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);

        Guid mover;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            mover = await SeedUserAsync(db, _companyAId, "employee", _departmentAId);
        }

        var v1 = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");
        await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{v1.Id}/entries",
            Entry(mover, new Dictionary<string, string?> { ["work_mode"] = "onsite" }));

        var v2 = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Close");
        await client.PostAsJsonAsync(
            $"/admin/demographic-snapshots/{v2.Id}/entries",
            Entry(mover, new Dictionary<string, string?> { ["work_mode"] = "remote" }));

        await client.PostAsync($"/admin/demographic-snapshots/{v2.Id}/changes/recompute", null);
        var second = await client.PostAsync($"/admin/demographic-snapshots/{v2.Id}/changes/recompute", null);
        var result = (await second.Content.ReadFromJsonAsync<RecomputeSnapshotChangesResponse>())!;

        Assert.Equal(1, result.ComputedCount);
        Assert.Single(result.Snapshot.Changes);
    }

    [Fact]
    public async Task Recompute_on_the_first_snapshot_of_a_survey_reports_no_prior_version()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        var response = await client.PostAsync($"/admin/demographic-snapshots/{snapshot.Id}/changes/recompute", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<RecomputeSnapshotChangesResponse>())!;
        Assert.Null(result.PriorVersion);
        Assert.Equal(0, result.ComputedCount);
    }

    [Fact]
    public async Task Listing_is_scoped_to_the_company_and_optionally_to_one_survey()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);
        await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Launch");

        var all = await client.GetFromJsonAsync<List<DemographicSnapshotListItem>>(
            $"/admin/demographic-snapshots?companyId={_companyAId}");
        var filtered = await client.GetFromJsonAsync<List<DemographicSnapshotListItem>>(
            $"/admin/demographic-snapshots?companyId={_companyAId}&surveyId={_surveyBId}");

        Assert.NotEmpty(all!);
        Assert.All(all!, s => Assert.Equal(_companyAId, s.CompanyId));
        Assert.Empty(filtered!);
    }

    [Fact]
    public async Task Listing_another_companys_snapshots_is_forbidden()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);

        var response = await client.GetAsync($"/admin/demographic-snapshots?companyId={_companyBId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_employee_cannot_touch_snapshots()
    {
        var ownerClient = await AdminClientAsync(_companyAId, _companyADomain);
        var snapshot = await CreateSnapshotAsync(ownerClient, _surveyAId, _companyAId, "Launch");

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var read = await client.GetAsync($"/admin/demographic-snapshots/{snapshot.Id}");
        var write = await client.PostAsJsonAsync(
            "/admin/demographic-snapshots", new CreateDemographicSnapshotRequest(_surveyAId, _companyAId, "Nope"));

        Assert.Equal(HttpStatusCode.Forbidden, read.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
    }

    [Fact]
    public async Task A_missing_snapshot_is_a_404()
    {
        var client = await AdminClientAsync(_companyAId, _companyADomain);

        var response = await client.GetAsync($"/admin/demographic-snapshots/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// #285: <c>demographic_snapshots.created_by</c> must name the caller's own row, even
    /// when their <c>sub</c> spells another user's <c>Id</c>.
    ///
    /// <c>persona_external_id</c> is a free-form 64-character string, so nothing stops one
    /// being a Guid in canonical form -- #154's ETL is the feature that will start filling
    /// the column from legacy ids. The collider's <c>sub</c> is minted from their own
    /// <c>PersonaExternalId</c> (<c>PersonaExternalId ?? Id</c>, AuthEndpoints), which here
    /// is the victim's <c>Id</c>. This endpoint resolved <c>Id</c> first until #285, and a
    /// snapshot is a compliance record -- who took it is the point of storing it.
    /// </summary>
    [Fact]
    public async Task A_guid_shaped_external_id_never_credits_the_snapshot_to_the_user_whose_id_it_matches()
    {
        var victimEmail = $"{Guid.NewGuid():N}@{_companyADomain}";
        var colliderEmail = $"{Guid.NewGuid():N}@{_companyADomain}";
        var client = _factory.CreateClient();
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Victim", victimEmail, "a-good-password")))
            .EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Collider", colliderEmail, "a-good-password")))
            .EnsureSuccessStatusCode();

        Guid colliderId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var victim = await db.Users.FirstAsync(u => u.Email == victimEmail);
            var collider = await db.Users.FirstAsync(u => u.Email == colliderEmail);
            collider.Role = Roles.CompanyAdmin;
            collider.CompanyId = _companyAId;
            collider.PersonaExternalId = victim.Id.ToString();
            await db.SaveChangesAsync();
            colliderId = collider.Id;
            Assert.NotEqual(victim.Id, collider.Id);
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(colliderEmail, "a-good-password"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        var snapshot = await CreateSnapshotAsync(client, _surveyAId, _companyAId, "Collision");

        Assert.Equal(colliderId, snapshot.CreatedBy);
    }
}
