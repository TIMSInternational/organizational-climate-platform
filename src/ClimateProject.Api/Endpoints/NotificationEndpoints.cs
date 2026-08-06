using System.Linq.Expressions;
using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Notification dispatch (admin) and the self-service surface (any authenticated user),
/// replacing legacy <c>api/notifications</c>, <c>notifications/[id]</c>,
/// <c>notifications/bulk</c> and <c>notifications/process</c> (#97).
///
/// Two different authorization rules live in this one file, and the distinction is the whole
/// point of the split:
///
/// * The **admin** routes are tenant-scoped in the usual way -- SuperAdmin, or CompanyAdmin
///   whose claim matches the target company.
/// * The **self-service** routes are scoped **per user, not per company**. A CompanyAdmin
///   must not be able to read an employee's inbox or flip their consent flags, even inside
///   their own tenant, so these routes resolve the caller's own user id and compare against
///   the row -- they never consult the role at all. That is a different check from the rest
///   of the codebase, which is why it is written out explicitly here rather than reusing
///   <see cref="CanAccessCompany"/>, and why there is a test for it.
/// </summary>
public static class NotificationEndpoints
{
    /// <summary>Most-recent-first page size for both list endpoints. Bounded so a large tenant cannot pull its whole notification history in one request.</summary>
    private const int MaxPageSize = 200;

    /// <summary>Recipients accepted by one bulk dispatch. Bounded because the whole batch is built in memory and saved in one transaction.</summary>
    private const int MaxBulkRecipients = 500;

    /// <summary>Notifications one <c>/process</c> sweep will attempt. Bounded so the request stays inside a sane timeout; call it again for more.</summary>
    private const int ProcessBatchSize = 200;

    private const int FailureReasonMaxLength = 1000;
    private const int TitleMaxLength = 500;

    private const string LogCategory = "ClimateProject.Api.Notifications";

    public static void MapNotificationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/notifications").RequireAuthorization();

        // Admin: dispatch and oversight.
        group.MapGet("", ListForCompanyAsync);
        group.MapPost("", DispatchAsync);
        group.MapPost("/bulk", DispatchBulkAsync);
        group.MapPost("/process", ProcessDueAsync);

        // Self-service: the caller's own inbox and their own consent.
        group.MapGet("/mine", ListMineAsync);
        group.MapGet("/preferences", GetPreferencesAsync);
        group.MapPut("/preferences", UpdatePreferencesAsync);
        group.MapPost("/{id:guid}/read", MarkReadAsync);
    }

    // The house multi-tenant shape, unchanged: SuperAdmin short-circuits first, then a
    // CompanyAdmin whose claim matches. Never weakened to a bare role check.
    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    /// <summary>
    /// The acting user's own row id.
    ///
    /// The <c>sub</c> claim is <c>PersonaExternalId ?? Id</c> (see <c>AuthEndpoints</c>), so
    /// both shapes have to be tried. Returns null rather than <see cref="Guid.Empty"/> when
    /// neither resolves: an unresolvable caller must get an explicit 403, not be silently
    /// treated as the owner of every row whose <c>user_id</c> happens to be all zeroes.
    /// </summary>
    private static async Task<Guid?> ResolveCurrentUserIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId)
            && await db.Users.AnyAsync(u => u.Id == userId, cancellationToken))
        {
            return userId;
        }

        var byExternalId = await db.Users
            .Where(u => u.PersonaExternalId == currentUser.Sub)
            .Select(u => (Guid?)u.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return byExternalId;
    }

    // Declared before ToDetail below: static field initialisers run in textual order, and
    // the compiled delegate is built from this expression.
    //
    // This is an Expression, not a plain method, because EF Core cannot translate a call to
    // a custom static method inside a Select -- the notifications plan's own sketch used
    // `.Select(n => ToDetail(n))`, which throws "could not be translated" at runtime. One
    // expression, compiled once for the in-memory path, keeps the two shapes from drifting.
    private static readonly Expression<Func<Notification, NotificationDetail>> DetailProjection =
        n => new NotificationDetail(
            n.Id,
            n.UserId,
            n.CompanyId,
            n.Type,
            n.Channel,
            n.Priority,
            n.Status,
            n.Title,
            n.Message,
            n.Data,
            n.TemplateId,
            n.ScheduledFor,
            n.SentAt,
            n.DeliveredAt,
            n.OpenedAt,
            n.FailedAt,
            n.FailureReason,
            n.RetryCount,
            n.CreatedAt);

    private static readonly Func<Notification, NotificationDetail> DetailOf = DetailProjection.Compile();

    private static async Task<IResult> ListForCompanyAsync(
        Guid companyId,
        string? status,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        if (status is not null && !NotificationStatuses.IsKnown(status))
        {
            return Results.Json(
                new { message = $"Invalid status '{status}'. Supported: {string.Join(", ", NotificationStatuses.All)}" },
                statusCode: 400);
        }

        var query = db.Notifications.AsNoTracking().Where(n => n.CompanyId == companyId);
        if (status is not null)
        {
            query = query.Where(n => n.Status == status);
        }

        var notifications = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(MaxPageSize)
            .Select(DetailProjection)
            .ToListAsync(cancellationToken);

        return Results.Ok(new NotificationListResponse(notifications));
    }

    private static async Task<IResult> DispatchAsync(
        CreateNotificationRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        if (!TryValidateContent(request.Type, request.Channel, request.Priority, request.Title, request.Message, request.Data,
                out var content, out var contentError))
        {
            return Results.Json(new { message = contentError }, statusCode: 400);
        }

        if (await ValidateTemplateAsync(db, request.TemplateId, request.CompanyId, cancellationToken) is { } templateError)
        {
            return Results.Json(new { message = templateError }, statusCode: 400);
        }

        // One round trip, and it brings the recipient's preferences with it -- NotificationPreferences
        // is an owned type, so its columns are on the users row already. No second query.
        var recipient = await db.Users
            .FirstOrDefaultAsync(u => u.Id == request.UserId && u.CompanyId == request.CompanyId, cancellationToken);
        if (recipient is null)
        {
            return Results.Json(new { message = "Recipient not found in this company" }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var notification = NewNotification(request.UserId, request.CompanyId, content, request.TemplateId, request.ScheduledFor, now);
        db.Notifications.Add(notification);

        await DeliverIfDueAsync(notification, recipient.Notifications, sender, loggerFactory, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(DetailOf(notification), statusCode: 201);
    }

    /// <summary>
    /// Dispatch one notification to many recipients.
    ///
    /// The database work here is O(1) round trips, not O(recipients): one SELECT loads every
    /// named recipient (with their preferences, which ride along on the users row as owned
    /// columns), the whole batch is built in memory, and one <c>SaveChangesAsync</c> writes
    /// it. Nothing inside the per-recipient loop touches the database -- that loop only calls
    /// <see cref="INotificationSender"/>, which is the seam a real provider will batch behind
    /// its own API.
    /// </summary>
    private static async Task<IResult> DispatchBulkAsync(
        CreateBulkNotificationRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        var requestedIds = (request.UserIds ?? []).Distinct().ToList();
        if (requestedIds.Count == 0)
        {
            return Results.Json(new { message = "UserIds must contain at least one recipient" }, statusCode: 400);
        }

        if (requestedIds.Count > MaxBulkRecipients)
        {
            return Results.Json(
                new { message = $"UserIds contains {requestedIds.Count} recipients; the maximum per request is {MaxBulkRecipients}" },
                statusCode: 400);
        }

        if (!TryValidateContent(request.Type, request.Channel, request.Priority, request.Title, request.Message, request.Data,
                out var content, out var contentError))
        {
            return Results.Json(new { message = contentError }, statusCode: 400);
        }

        if (await ValidateTemplateAsync(db, request.TemplateId, request.CompanyId, cancellationToken) is { } templateError)
        {
            return Results.Json(new { message = templateError }, statusCode: 400);
        }

        var recipients = await db.Users
            .Where(u => requestedIds.Contains(u.Id) && u.CompanyId == request.CompanyId)
            .ToListAsync(cancellationToken);

        var known = recipients.Select(u => u.Id).ToHashSet();
        var unknown = requestedIds.Where(id => !known.Contains(id)).ToList();

        var now = DateTimeOffset.UtcNow;
        var created = new List<Notification>(recipients.Count);
        foreach (var recipient in recipients)
        {
            var notification = NewNotification(recipient.Id, request.CompanyId, content, request.TemplateId, request.ScheduledFor, now);
            created.Add(notification);
            await DeliverIfDueAsync(notification, recipient.Notifications, sender, loggerFactory, now, cancellationToken);
        }

        db.Notifications.AddRange(created);
        await db.SaveChangesAsync(cancellationToken);

        var details = created.Select(DetailOf).ToList();
        return Results.Json(
            new BulkNotificationResult(
                requestedIds.Count,
                created.Count,
                created.Count(n => n.Status == NotificationStatuses.Sent),
                created.Count(n => n.Status == NotificationStatuses.Cancelled),
                created.Count(n => n.Status == NotificationStatuses.Failed),
                unknown,
                details),
            statusCode: 201);
    }

    /// <summary>
    /// Deliver everything that is now due -- notifications scheduled for the future, and
    /// earlier attempts that failed and still have retries left.
    ///
    /// Bounded the same way bulk dispatch is: one SELECT for the due batch, one SELECT for
    /// the distinct recipients, one save. There is no per-notification query.
    /// </summary>
    private static async Task<IResult> ProcessDueAsync(
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        // A sweep with no company is a cross-tenant operation, so it is SuperAdmin-only --
        // the same rule the codebase applies to every other globally-scoped write.
        if (companyId is null)
        {
            if (currentUser.Role != Roles.SuperAdmin) return Results.Forbid();
        }
        else if (!CanAccessCompany(currentUser, companyId.Value))
        {
            return Results.Forbid();
        }

        var now = DateTimeOffset.UtcNow;
        var query = db.Notifications.Where(n =>
            NotificationStatuses.Retryable.Contains(n.Status)
            && n.ScheduledFor <= now
            && n.RetryCount < n.MaxRetries);

        if (companyId is not null)
        {
            query = query.Where(n => n.CompanyId == companyId.Value);
        }

        var due = await query
            .OrderBy(n => n.ScheduledFor)
            .Take(ProcessBatchSize)
            .ToListAsync(cancellationToken);

        if (due.Count == 0)
        {
            return Results.Ok(new NotificationProcessResult(0, 0, 0, 0));
        }

        var recipientIds = due.Select(n => n.UserId).Distinct().ToList();
        var preferences = await db.Users
            .Where(u => recipientIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Notifications, cancellationToken);

        var attempted = 0;
        foreach (var notification in due)
        {
            if (!preferences.TryGetValue(notification.UserId, out var recipientPreferences))
            {
                // Cannot happen while the user_id FK holds; skipping rather than assuming a
                // default preference set, because assuming would mean mailing someone whose
                // opt-outs we could not read.
                continue;
            }

            attempted++;
            await AttemptDeliveryAsync(notification, recipientPreferences, sender, loggerFactory, DateTimeOffset.UtcNow, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new NotificationProcessResult(
            attempted,
            due.Count(n => n.Status == NotificationStatuses.Sent),
            due.Count(n => n.Status == NotificationStatuses.Cancelled),
            due.Count(n => n.Status == NotificationStatuses.Failed)));
    }

    private static async Task<IResult> ListMineAsync(
        bool? unreadOnly,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var userId = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        if (userId is null) return Results.Forbid();

        var query = db.Notifications.AsNoTracking().Where(n => n.UserId == userId.Value);
        if (unreadOnly == true)
        {
            query = query.Where(n => n.OpenedAt == null);
        }

        var notifications = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(MaxPageSize)
            .Select(DetailProjection)
            .ToListAsync(cancellationToken);

        return Results.Ok(new NotificationListResponse(notifications));
    }

    private static async Task<IResult> MarkReadAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var userId = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        if (userId is null) return Results.Forbid();

        var notification = await db.Notifications.FirstOrDefaultAsync(n => n.Id == id, cancellationToken);
        if (notification is null)
        {
            return Results.Json(new { message = "Notification not found" }, statusCode: 404);
        }

        // Per-user, not per-company. A CompanyAdmin is not privileged here.
        if (notification.UserId != userId.Value) return Results.Forbid();

        // Idempotent: re-reading does not move the timestamp, so "first opened at" stays true.
        notification.OpenedAt ??= DateTimeOffset.UtcNow;

        // "opened" is a later state than "sent"/"delivered", so it may advance those -- but it
        // must never overwrite "failed" or "cancelled", which record why a delivery did not
        // happen and would otherwise be erased by the recipient glancing at their inbox.
        if (notification.Status is NotificationStatuses.Sent or NotificationStatuses.Delivered)
        {
            notification.Status = NotificationStatuses.Opened;
        }

        notification.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(DetailOf(notification));
    }

    private static async Task<IResult> GetPreferencesAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var userId = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        if (userId is null) return Results.Forbid();

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId.Value, cancellationToken);
        if (user is null) return Results.Forbid();

        return Results.Ok(NotificationPreferenceUpdate.ToResponse(user.Notifications));
    }

    /// <summary>
    /// Change the caller's own preferences. Five of the six stored preferences are readable
    /// and writable here; <c>PushNotifications</c> is neither, and
    /// <see cref="NotificationPreferenceUpdate.TryApply"/> never touches it, so its stored
    /// value survives every self-service write.
    /// </summary>
    private static async Task<IResult> UpdatePreferencesAsync(
        UpdateNotificationPreferencesRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var userId = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        if (userId is null) return Results.Forbid();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, cancellationToken);
        if (user is null) return Results.Forbid();

        if (!NotificationPreferenceUpdate.TryApply(user.Notifications, request, out var error))
        {
            return Results.Json(new { message = error }, statusCode: 400);
        }

        // These are consent flags in everything but name, so a change to one is a change to
        // what the user has agreed to receive -- stamped the same way UserConsent changes are.
        user.ConsentUpdatedAt = DateTimeOffset.UtcNow;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(NotificationPreferenceUpdate.ToResponse(user.Notifications));
    }

    private readonly record struct NotificationContent(
        string Type,
        string Channel,
        string Priority,
        string Title,
        string Message,
        string? Data);

    private static bool TryValidateContent(
        string? type,
        string? channel,
        string? priority,
        string? title,
        string? message,
        string? data,
        out NotificationContent content,
        out string? error)
    {
        content = default;
        error = null;

        var trimmedType = type?.Trim();
        var trimmedChannel = channel?.Trim();
        var trimmedTitle = title?.Trim();
        var trimmedMessage = message?.Trim();

        if (string.IsNullOrWhiteSpace(trimmedType) || string.IsNullOrWhiteSpace(trimmedChannel)
            || string.IsNullOrWhiteSpace(trimmedTitle) || string.IsNullOrWhiteSpace(trimmedMessage))
        {
            error = "Type, Channel, Title, and Message are required";
            return false;
        }

        if (!NotificationTypes.IsKnown(trimmedType))
        {
            error = $"Invalid type '{trimmedType}'. Supported: {string.Join(", ", NotificationTypes.All)}";
            return false;
        }

        if (!NotificationChannels.IsDispatchable(trimmedChannel))
        {
            // Named separately from an outright unknown channel, because "push" is a real
            // channel this platform simply cannot deliver on yet -- see NotificationChannels.
            error = NotificationChannels.IsKnown(trimmedChannel)
                ? $"Channel '{trimmedChannel}' cannot be dispatched: this platform has no delivery path for it yet. Supported: {string.Join(", ", NotificationChannels.Dispatchable)}"
                : $"Invalid channel '{trimmedChannel}'. Supported: {string.Join(", ", NotificationChannels.Dispatchable)}";
            return false;
        }

        if (trimmedTitle.Length > TitleMaxLength)
        {
            error = $"Title must be {TitleMaxLength} characters or fewer";
            return false;
        }

        var resolvedPriority = string.IsNullOrWhiteSpace(priority) ? NotificationPriorities.Default : priority.Trim();
        if (!NotificationPriorities.IsKnown(resolvedPriority))
        {
            error = $"Invalid priority '{resolvedPriority}'. Supported: {string.Join(", ", NotificationPriorities.All)}";
            return false;
        }

        // `data` is a jsonb column. Postgres rejects malformed JSON at INSERT, which without
        // this check surfaces as an opaque 500 from the global exception handler rather than
        // as a message telling the caller which field is wrong.
        if (!string.IsNullOrWhiteSpace(data))
        {
            try
            {
                using var _ = JsonDocument.Parse(data);
            }
            catch (JsonException)
            {
                error = "Data must be valid JSON";
                return false;
            }
        }

        content = new NotificationContent(
            trimmedType,
            trimmedChannel,
            resolvedPriority,
            trimmedTitle,
            trimmedMessage,
            string.IsNullOrWhiteSpace(data) ? null : data);
        return true;
    }

    /// <summary>
    /// Returns an error message when <paramref name="templateId"/> is unusable, or null when
    /// it is absent (which is legitimate -- dispatch does not require a template) or valid.
    ///
    /// A template is usable by a company if it is that company's or global. Without this
    /// check a CompanyAdmin could pin another tenant's template id onto their own
    /// notifications, which is a cross-tenant reference the FK alone does not prevent.
    /// </summary>
    private static async Task<string?> ValidateTemplateAsync(
        ClimateProjectDbContext db,
        Guid? templateId,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        if (templateId is null) return null;

        var usable = await db.NotificationTemplates
            .AnyAsync(t => t.Id == templateId.Value && (t.CompanyId == null || t.CompanyId == companyId), cancellationToken);

        return usable ? null : "TemplateId does not reference a template available to this company";
    }

    private static Notification NewNotification(
        Guid userId,
        Guid companyId,
        NotificationContent content,
        Guid? templateId,
        DateTimeOffset? scheduledFor,
        DateTimeOffset now) => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CompanyId = companyId,
            Type = content.Type,
            Channel = content.Channel,
            Priority = content.Priority,
            Status = NotificationStatuses.Default,
            Title = content.Title,
            Message = content.Message,
            Data = content.Data,
            TemplateId = templateId,
            ScheduledFor = scheduledFor ?? now,
            RetryCount = 0,
            MaxRetries = 3,
            CreatedAt = now,
            UpdatedAt = now,
        };

    /// <summary>
    /// Deliver now if the notification is due now; otherwise leave it
    /// <see cref="NotificationStatuses.Pending"/> for <c>POST /notifications/process</c>.
    ///
    /// A future-dated notification deliberately does **not** get its consent decision made
    /// here: preferences are consulted at delivery time, so a recipient who opts out between
    /// scheduling and sending is honoured.
    /// </summary>
    private static async Task DeliverIfDueAsync(
        Notification notification,
        NotificationPreferences preferences,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (notification.ScheduledFor > now) return;

        await AttemptDeliveryAsync(notification, preferences, sender, loggerFactory, now, cancellationToken);
    }

    private static async Task AttemptDeliveryAsync(
        Notification notification,
        NotificationPreferences preferences,
        INotificationSender sender,
        ILoggerFactory loggerFactory,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var decision = NotificationDispatchPolicy.Decide(notification.Channel, notification.Type, preferences);
        if (!decision.ShouldDeliver)
        {
            // "cancelled", never "failed": nothing broke, the recipient asked not to receive
            // this. Marking it failed would put it back in the retry sweep and mail them anyway.
            notification.Status = NotificationStatuses.Cancelled;
            notification.FailureReason = Truncate(decision.SuppressionReason);
            notification.UpdatedAt = now;
            return;
        }

        NotificationDeliveryResult result;
        try
        {
            result = await sender.SendAsync(notification, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            // A sender that throws must not take the whole batch down with it, and must not
            // leave the row claiming "sent". The exception text is logged, never echoed to
            // the caller or stored -- a provider exception routinely carries endpoint URLs
            // and credentials.
            loggerFactory.CreateLogger(LogCategory).LogError(
                exception,
                "Notification sender threw while delivering notification {NotificationId} via {Channel}.",
                notification.Id,
                notification.Channel);
            result = NotificationDeliveryResult.Failure("The delivery provider reported an unexpected error.");
        }

        if (result.Delivered)
        {
            notification.Status = NotificationStatuses.Sent;
            notification.SentAt = now;
            notification.FailedAt = null;
            notification.FailureReason = null;
        }
        else
        {
            notification.Status = NotificationStatuses.Failed;
            notification.FailedAt = now;
            notification.FailureReason = Truncate(result.FailureReason) ?? "Delivery failed.";
            notification.RetryCount++;
        }

        notification.UpdatedAt = now;
    }

    private static string? Truncate(string? value)
        => value is null || value.Length <= FailureReasonMaxLength
            ? value
            : value[..FailureReasonMaxLength];
}
