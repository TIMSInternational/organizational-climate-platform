using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Tracking;

/// <summary>
/// `/api/internal/send-notification`, which was a no-op returning 200 until 2026-09-15.
///
/// The reason these cases assert ROWS rather than the status code: the endpoint it replaces
/// already returned 200 and already satisfied every caller, and the tracking module then
/// recorded `EstadoEnvio = Enviado` and refused to raise the trigger again. A test that
/// checked the response would have passed against the stub.
/// </summary>
[Collection("Postgres")]
public class TrackingSendNotificationTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private Guid _companyId;
    private Guid _byPersonaId;
    private Guid _byGuidId;
    private string _personaExternalId = null!;

    public TrackingSendNotificationTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var domain = $"send-{Guid.NewGuid():N}.test";
        _companyId = Guid.NewGuid();
        _byPersonaId = Guid.NewGuid();
        _byGuidId = Guid.NewGuid();
        _personaExternalId = $"PER-{Guid.NewGuid():N}"[..14];

        db.Companies.Add(new Company { Id = _companyId, Name = "Send Co", EmailDomain = domain, CreatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();

        // One person tracking knows by an explicit persona id...
        db.Users.Add(new User
        {
            Id = _byPersonaId, CompanyId = _companyId, Email = $"lider@{domain}", Name = "La lider",
            Role = "leader", PersonaExternalId = _personaExternalId, IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        // ...and one it knows only by the user's own GUID, which is what
        // TrackingIdentifiers.ExternalPersonaId falls back to.
        db.Users.Add(new User
        {
            Id = _byGuidId, CompanyId = _companyId, Email = $"responsable@{domain}", Name = "El responsable",
            Role = "employee", IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private HttpClient Client()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);
        return client;
    }

    private static object Body(Guid planId, IEnumerable<string> recipients, string trigger = "vencimiento") => new
    {
        destinatarios_ids = recipients.ToArray(),
        tipo_disparador = trigger,
        contenido = "El plan PA-2026-00123 vencio el 2026-08-01 y no ha sido marcado como cumplido.",
        plan_id = planId.ToString(),
    };

    [Fact]
    public async Task It_raises_one_pending_email_per_recipient_and_resolves_both_spellings_of_a_persona_id()
    {
        var planId = Guid.NewGuid();

        var response = await Client().PostAsJsonAsync(
            "/api/internal/send-notification",
            Body(planId, [_personaExternalId, _byGuidId.ToString()]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var raised = await db.Notifications
            .Where(n => n.UserId == _byPersonaId || n.UserId == _byGuidId)
            .ToListAsync();

        Assert.Equal(2, raised.Count);
        foreach (var n in raised)
        {
            // Pending and due NOW is what makes the dispatcher pick it up on its next minute.
            // A row the sweep never finds is the stub in a different costume.
            Assert.Equal(NotificationStatuses.Pending, n.Status);
            Assert.Equal(NotificationChannels.Email, n.Channel);
            Assert.True(n.ScheduledFor <= DateTimeOffset.UtcNow);
            Assert.Equal(_companyId, n.CompanyId);
            Assert.Contains("PA-2026-00123", n.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task A_replay_creates_nothing_and_says_so()
    {
        var planId = Guid.NewGuid();
        var first = await Client().PostAsJsonAsync("/api/internal/send-notification", Body(planId, [_personaExternalId]));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await Client().PostAsJsonAsync("/api/internal/send-notification", Body(planId, [_personaExternalId]));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var id = DeterministicNotificationId.ForTrackingPlanNotification(planId, _byPersonaId, "vencimiento");

        // Exactly one row for (plan, recipient, trigger), and it is the deterministic one —
        // the tracking worker retries a Fallido row, so a second call must not mail twice.
        Assert.Equal(1, await db.Notifications.CountAsync(n => n.UserId == _byPersonaId && n.Id == id));
        Assert.Equal(1, await db.Notifications.CountAsync(n => n.UserId == _byPersonaId));

        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("data").GetProperty("created").GetInt32());
        Assert.Equal(1, body.GetProperty("data").GetProperty("duplicates").GetInt32());
    }

    [Fact]
    public async Task An_id_that_matches_no_user_is_named_back_rather_than_dropped()
    {
        var response = await Client().PostAsJsonAsync(
            "/api/internal/send-notification",
            Body(Guid.NewGuid(), [_personaExternalId, "PER-does-not-exist"]));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, body.GetProperty("data").GetProperty("created").GetInt32());
        var unresolved = body.GetProperty("data").GetProperty("unresolved").EnumerateArray().Select(x => x.GetString()).ToList();

        // Named, not counted: a stale persona cache and a deactivated person look identical
        // in a number, and this endpoint's whole history is a success that meant nothing.
        Assert.Equal(["PER-does-not-exist"], unresolved);
    }

    [Theory]
    [InlineData("vencimiento", NotificationTypes.DeadlineReminder)]
    [InlineData("alerta_15_dias", NotificationTypes.DeadlineReminder)]
    [InlineData("recordatorio_30_dias", NotificationTypes.DeadlineReminder)]
    [InlineData("actualizacion_avance", NotificationTypes.ActionPlanAlert)]
    [InlineData("apertura_ciclo", NotificationTypes.ActionPlanAlert)]
    [InlineData("a_word_this_build_has_never_heard", NotificationTypes.ActionPlanAlert)]
    public async Task The_trigger_decides_the_type_and_an_unknown_one_still_notifies(string trigger, string expected)
    {
        var planId = Guid.NewGuid();
        await Client().PostAsJsonAsync("/api/internal/send-notification", Body(planId, [_personaExternalId], trigger));

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var id = DeterministicNotificationId.ForTrackingPlanNotification(planId, _byPersonaId, trigger);
        var raised = await db.Notifications.SingleAsync(n => n.Id == id);

        Assert.Equal(expected, raised.Type);
    }

    [Fact]
    public async Task An_empty_body_is_refused_now_that_a_success_response_means_something()
    {
        var response = await Client().PostAsJsonAsync("/api/internal/send-notification", new { });

        // It used to answer 200 to this. That was the defect: the caller marked its row sent.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
