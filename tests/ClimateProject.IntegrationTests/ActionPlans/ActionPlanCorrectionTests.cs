using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.ActionPlans;

/// <summary>
/// G24: a plan can be corrected after it is created, its progress history survives a reload,
/// and an administrator can delete it -- with every write audited and nobody but an
/// administrator of the plan's company allowed to do any of it.
/// </summary>
[Collection("Postgres")]
public class ActionPlanCorrectionTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domainA = $"apc-a-{Guid.NewGuid():N}.test";
    private readonly string _domainB = $"apc-b-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public ActionPlanCorrectionTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var a = new Company { Id = Guid.NewGuid(), Name = "Correction A", EmailDomain = _domainA, CreatedAt = DateTimeOffset.UtcNow };
        var b = new Company { Id = Guid.NewGuid(), Name = "Correction B", EmailDomain = _domainB, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(a, b);
        _companyAId = a.Id;
        _companyBId = b.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private sealed record Caller(HttpClient Client, Guid UserId, string Name);

    private async Task<Caller> SignInAsync(string role, string domain, Guid companyId, string name = "Test User")
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{domain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest(name, email, "A-good-passw0rd"));

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return new Caller(client, userId, name);
    }

    private async Task<ActionPlanDetail> CreatePlanAsync(Caller admin, Guid? ownerId = null, bool withMeasures = false)
    {
        var response = await admin.Client.PostAsJsonAsync("/action-plans", new CreateActionPlanRequest(
            Title: "Reconocer el trabajo bien hecho",
            Description: "Un estándar de reconocimiento",
            CompanyId: _companyAId,
            DepartmentId: null,
            DueDate: new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero),
            Priority: "medium",
            Tags: ["seguimiento"],
            TemplateId: null,
            SourceSurveyId: null,
            SourceInsightId: null,
            Kpis: withMeasures ? [new("Adopción", 100, "por ciento", "monthly")] : null,
            Objectives: withMeasures ? [new("Publicar el estándar", "Publicado")] : null,
            OwnerId: ownerId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ActionPlanDetail>())!;
    }

    private async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> work)
    {
        using var scope = _factory.Services.CreateScope();
        return await work(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    // -- editing -------------------------------------------------------------------------

    [Fact]
    public async Task An_admin_corrects_title_description_due_date_and_tags_and_the_write_is_audited()
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var plan = await CreatePlanAsync(admin);
        var newDue = new DateTimeOffset(2027, 1, 15, 0, 0, 0, TimeSpan.Zero);

        var put = await admin.Client.PutAsJsonAsync($"/action-plans/{plan.Id}", new UpdateActionPlanRequest(
            Title: "Reconocer el trabajo en equipo",
            Description: "Un estándar corregido",
            DueDate: newDue,
            Status: null,
            Priority: null,
            Tags: ["seguimiento", "operaciones"]));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        // A fresh read, not the PUT's echo: the correction has to be what the database holds.
        var read = (await admin.Client.GetFromJsonAsync<ActionPlanDetail>($"/action-plans/{plan.Id}?lang=es"))!;
        Assert.Equal("Reconocer el trabajo en equipo", read.Title);
        Assert.Equal("Un estándar corregido", read.Description);
        Assert.Equal(newDue, read.DueDate);
        Assert.Equal(["seguimiento", "operaciones"], read.Tags);

        var audited = await WithDbAsync(db => db.AuditLogs.AsNoTracking()
            .Where(a => a.UserId == admin.UserId && a.ResourceId == plan.Id.ToString())
            .Select(a => a.Action)
            .ToListAsync());
        Assert.Contains("action-plans.update", audited);
    }

    [Fact]
    public async Task A_leader_who_owns_a_plan_still_cannot_correct_it()
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var leader = await SignInAsync(Roles.Leader, _domainA, _companyAId);
        var plan = await CreatePlanAsync(admin, ownerId: leader.UserId);

        var put = await leader.Client.PutAsJsonAsync($"/action-plans/{plan.Id}", new UpdateActionPlanRequest(
            "Otro título", null, null, null, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
        var stored = await WithDbAsync(db => db.ActionPlans.AsNoTracking().SingleAsync(p => p.Id == plan.Id));
        Assert.Equal("Reconocer el trabajo bien hecho", stored.TitleEs ?? stored.TitleEn);
    }

    // -- progress history ----------------------------------------------------------------

    [Fact]
    public async Task Progress_history_is_read_back_oldest_first_with_who_recorded_it()
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId, name: "Ana Administradora");
        var plan = await CreatePlanAsync(admin);

        foreach (var note in new[] { "Primera reunión hecha", "Estándar en borrador" })
        {
            var posted = await admin.Client.PostAsJsonAsync($"/action-plans/{plan.Id}/progress", new RecordProgressRequest(note, null, null));
            Assert.Equal(HttpStatusCode.Created, posted.StatusCode);
        }

        // A different client: nothing the first one remembers can be what answers.
        var reloaded = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var response = await reloaded.Client.GetAsync($"/action-plans/{plan.Id}/progress");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var history = (await response.Content.ReadFromJsonAsync<ProgressHistoryResponse>())!;

        Assert.Equal(["Primera reunión hecha", "Estándar en borrador"], history.Updates.Select(u => u.OverallNotes));
        Assert.All(history.Updates, u =>
        {
            Assert.Equal(admin.UserId, u.UpdatedBy);
            Assert.Equal("Ana Administradora", u.UpdatedByName);
        });
    }

    [Fact]
    public async Task A_plan_with_no_progress_has_an_empty_history_not_an_error()
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var plan = await CreatePlanAsync(admin);

        var history = (await admin.Client.GetFromJsonAsync<ProgressHistoryResponse>($"/action-plans/{plan.Id}/progress"))!;

        Assert.Empty(history.Updates);
    }

    [Fact]
    public async Task Progress_history_is_readable_by_whoever_may_read_the_plan_and_nobody_else()
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var owner = await SignInAsync(Roles.Leader, _domainA, _companyAId);
        var otherLeader = await SignInAsync(Roles.Leader, _domainA, _companyAId);
        var otherCompanyAdmin = await SignInAsync(Roles.CompanyAdmin, _domainB, _companyBId);
        var plan = await CreatePlanAsync(admin, ownerId: owner.UserId);
        await admin.Client.PostAsJsonAsync($"/action-plans/{plan.Id}/progress", new RecordProgressRequest("Avance", null, null));

        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync($"/action-plans/{plan.Id}/progress")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherLeader.Client.GetAsync($"/action-plans/{plan.Id}/progress")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherCompanyAdmin.Client.GetAsync($"/action-plans/{plan.Id}/progress")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.Client.GetAsync($"/action-plans/{Guid.NewGuid()}/progress")).StatusCode);
    }

    // -- delete --------------------------------------------------------------------------

    [Fact]
    public async Task Deleting_a_plan_removes_its_measures_and_history_cancels_its_unsent_nudges_and_is_audited()
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var owner = await SignInAsync(Roles.Leader, _domainA, _companyAId);
        var plan = await CreatePlanAsync(admin, ownerId: owner.UserId, withMeasures: true);
        var progress = await admin.Client.PostAsJsonAsync($"/action-plans/{plan.Id}/progress", new RecordProgressRequest(
            "Mitad del camino",
            [new(plan.Kpis[0].Id, 50, null)],
            [new(plan.Objectives[0].Id, "in_progress", 50, null)]));
        Assert.Equal(HttpStatusCode.Created, progress.StatusCode);

        // One nudge still waiting to go out, one already sent, and one about another plan.
        var otherPlan = await CreatePlanAsync(admin, ownerId: owner.UserId);
        var pendingId = Guid.NewGuid();
        var sentId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            Notification Nudge(Guid id, Guid planId, string status) => new()
            {
                Id = id,
                UserId = owner.UserId,
                CompanyId = _companyAId,
                Type = NotificationTypes.ActionPlanAlert,
                Channel = NotificationChannels.Email,
                Priority = NotificationPriorities.Medium,
                Status = status,
                Title = "Un plan de acción a tu cargo vence pronto",
                Message = "vence pronto",
                Data = ActionPlanNotificationData.Serialize(planId),
                ScheduledFor = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Notifications.AddRange(
                Nudge(pendingId, plan.Id, NotificationStatuses.Pending),
                Nudge(sentId, plan.Id, NotificationStatuses.Sent),
                Nudge(otherId, otherPlan.Id, NotificationStatuses.Pending));
            return await db.SaveChangesAsync();
        });

        var delete = await admin.Client.DeleteAsync($"/action-plans/{plan.Id}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await admin.Client.GetAsync($"/action-plans/{plan.Id}")).StatusCode);

        var left = await WithDbAsync(async db => new
        {
            Plans = await db.ActionPlans.CountAsync(p => p.Id == plan.Id),
            Kpis = await db.ActionPlanKpis.CountAsync(k => k.ActionPlanId == plan.Id),
            Objectives = await db.ActionPlanObjectives.CountAsync(o => o.ActionPlanId == plan.Id),
            Updates = await db.ActionPlanProgressUpdates.CountAsync(u => u.ActionPlanId == plan.Id),
            KpiReadings = await db.ActionPlanKpiUpdates.CountAsync(u => u.KpiId == plan.Kpis[0].Id),
            ObjectiveReadings = await db.ActionPlanObjectiveUpdates.CountAsync(u => u.ObjectiveId == plan.Objectives[0].Id),
            OtherPlanStands = await db.ActionPlans.AnyAsync(p => p.Id == otherPlan.Id),
            OwnerStands = await db.Users.AnyAsync(u => u.Id == owner.UserId),
            Statuses = await db.Notifications.AsNoTracking()
                .Where(n => n.Id == pendingId || n.Id == sentId || n.Id == otherId)
                .ToDictionaryAsync(n => n.Id, n => n.Status),
            Audited = await db.AuditLogs.AsNoTracking()
                .Where(a => a.UserId == admin.UserId && a.ResourceId == plan.Id.ToString())
                .Select(a => a.Action)
                .ToListAsync(),
        });

        Assert.Equal(0, left.Plans);
        Assert.Equal(0, left.Kpis);
        Assert.Equal(0, left.Objectives);
        Assert.Equal(0, left.Updates);
        Assert.Equal(0, left.KpiReadings);
        Assert.Equal(0, left.ObjectiveReadings);
        Assert.True(left.OtherPlanStands);
        Assert.True(left.OwnerStands);
        Assert.Equal(NotificationStatuses.Cancelled, left.Statuses[pendingId]);
        Assert.Equal(NotificationStatuses.Sent, left.Statuses[sentId]);
        Assert.Equal(NotificationStatuses.Pending, left.Statuses[otherId]);
        Assert.Contains("action-plans.delete", left.Audited);
    }

    [Theory]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task Only_an_administrator_may_delete_a_plan_even_one_they_own(string role)
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var owner = await SignInAsync(role, _domainA, _companyAId);
        var plan = await CreatePlanAsync(admin, ownerId: owner.UserId);

        var delete = await owner.Client.DeleteAsync($"/action-plans/{plan.Id}");

        Assert.Equal(HttpStatusCode.Forbidden, delete.StatusCode);
        Assert.True(await WithDbAsync(db => db.ActionPlans.AnyAsync(p => p.Id == plan.Id)));
    }

    [Fact]
    public async Task An_admin_of_another_company_cannot_delete_the_plan_and_an_unknown_id_is_404()
    {
        var admin = await SignInAsync(Roles.CompanyAdmin, _domainA, _companyAId);
        var otherAdmin = await SignInAsync(Roles.CompanyAdmin, _domainB, _companyBId);
        var plan = await CreatePlanAsync(admin);

        Assert.Equal(HttpStatusCode.Forbidden, (await otherAdmin.Client.DeleteAsync($"/action-plans/{plan.Id}")).StatusCode);
        Assert.True(await WithDbAsync(db => db.ActionPlans.AnyAsync(p => p.Id == plan.Id)));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.Client.DeleteAsync($"/action-plans/{Guid.NewGuid()}")).StatusCode);
    }
}
