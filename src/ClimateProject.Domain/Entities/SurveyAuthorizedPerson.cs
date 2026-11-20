namespace ClimateProject.Domain.Entities;

/// <summary>
/// One person on a survey's «Lista autorizada del cliente» (ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>, ruling 3): while a survey has a
/// non-empty list, a send, resend or reminder to anyone whose email is not on it is refused,
/// naming them. No list is today's behaviour.
/// </summary>
/// <remarks>
/// Keyed by EMAIL, not by user id, on purpose: the list is the client's spreadsheet, and the
/// question it answers is "is this address one the client named?" -- the audience is not the
/// population (CLAUDE.md, 28 Oct 2026). A person re-pointed to another address is therefore not
/// on the list until that address is added, which is the guard working.
/// </remarks>
public class SurveyAuthorizedPerson
{
    public Guid Id { get; set; }

    public Guid SurveyId { get; set; }

    /// <summary>Trimmed and lower-cased (invariant) before it is stored; unique per survey.</summary>
    public required string Email { get; set; }

    /// <summary>The name as the client's list gives it, if it gives one.</summary>
    public string? DisplayName { get; set; }

    /// <summary>Who added this address; null once that person is deleted.</summary>
    public Guid? AddedBy { get; set; }

    public DateTimeOffset AddedAt { get; set; }

    /// <summary>The stored form of an address: trimmed, lower-case invariant.</summary>
    public static string NormaliseEmail(string email)
    {
        ArgumentNullException.ThrowIfNull(email);
        return email.Trim().ToLowerInvariant();
    }
}
