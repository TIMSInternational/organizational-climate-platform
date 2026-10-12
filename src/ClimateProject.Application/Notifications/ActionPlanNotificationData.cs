using System.Text.Json;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// The <c>notifications.data</c> payload an <see cref="NotificationTypes.ActionPlanAlert"/>
/// carries -- written by <c>ActionPlanDueJob</c> when the nudge is raised, read back by
/// <c>EmailNotificationSender</c> to put the plan's link in the mail, and by the web inbox
/// (<c>notifications/next/derive.ts</c>, <c>idIn(data, 'actionPlanId')</c>) to draw the row's
/// "open the plan" action.
///
/// <para>
/// <b>One class for the same reason <see cref="SurveyNotificationData"/> is one class.</b>
/// The producer and the consumers live in different projects, and the inbox had been reading
/// <c>actionPlanId</c> since it shipped while nothing ever wrote it -- a nudge that told an
/// owner their plan was due and gave them no way to reach it.
/// </para>
/// <para>
/// <b>Only the id travels.</b> The link it builds is the ordinary <c>/action-plans/{id}</c>
/// page, which authorizes the reader itself, so the payload grants nothing; a stale or forged
/// id is a page that refuses, never a plan that opens.
/// </para>
/// </summary>
public static class ActionPlanNotificationData
{
    /// <summary>The plan the notification is about. The web inbox reads the same literal.</summary>
    public const string ActionPlanIdKey = "actionPlanId";

    /// <summary>The web app path of a plan, relative to the configured app base URL.</summary>
    public static string PlanPath(Guid planId) => $"action-plans/{planId}";

    /// <summary>The payload to persist. Serialised, never concatenated: the column is jsonb.</summary>
    public static string Serialize(Guid planId)
        => JsonSerializer.Serialize(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [ActionPlanIdKey] = planId.ToString(),
        });

    /// <summary>
    /// The plan id a payload names, or null when it names none that can be trusted. Never
    /// throws, for the reason <see cref="SurveyNotificationData.InvitationIdOrNull"/> gives:
    /// <c>POST /notifications</c> lets a company admin write <c>data</c> verbatim, and a
    /// payload no retry can fix must degrade to the link-less mail, not to a failed send.
    /// </summary>
    public static Guid? PlanIdOrNull(string? data)
    {
        if (string.IsNullOrWhiteSpace(data))
        {
            return null;
        }

        try
        {
            using var payload = JsonDocument.Parse(data);
            if (payload.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            return payload.RootElement.TryGetProperty(ActionPlanIdKey, out var value)
                   && value.ValueKind == JsonValueKind.String
                   && Guid.TryParse(value.GetString(), out var planId)
                   && planId != Guid.Empty
                ? planId
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
