namespace ClimateProject.Application.OrgStructure;

public sealed record BulkImportRowResult(
    int RowNumber,
    string Name,
    string Email,
    string Role,
    string? Department,
    string Status,
    IReadOnlyList<string> Errors,
    IReadOnlyList<BulkImportIssue> Issues);

/// <summary>
/// One reason a row cannot go in, as a stable code the screen translates, beside the English
/// sentence in <see cref="BulkImportRowResult.Errors"/> that the CSV path has always returned.
/// <see cref="Value"/> is what the reason is about when it is about something (the role or the
/// department the row named).
/// </summary>
public sealed record BulkImportIssue(string Code, string? Value = null);

/// <param name="Delivery">
/// What this import did about mail, as one of <see cref="BulkImportDelivery"/>'s three values --
/// and in a preview, what the apply would do, because a preview that described a different
/// delivery from the one it is approving would be worth nothing.
///
/// <para>Here because SILENCE IS NOT EVIDENCE. The three deliveries are decided by the
/// company's credential mode and the <c>withCredentials</c> flag together, so no caller can
/// work out from its own request alone whether anybody was written to -- and on 2026-10-20 one
/// tried: the climate importer dropped <c>--with-credentials</c> believing that meant "no
/// account email", which is the OTHER account email. A client that renders "each person will
/// receive a link" reads it from here, and the importer refuses to apply a preview whose
/// delivery is not the one it promised on screen.</para>
/// </param>
public sealed record BulkImportResponse(
    IReadOnlyList<BulkImportRowResult> Rows,
    int SuccessCount,
    int ErrorCount,
    string Delivery);

/// <summary>
/// The three things an import can do about mail. Exactly one of them is possible for any one
/// company, because <c>per_survey</c> cannot produce either account message: the credential it
/// hands out is minted per survey by <c>POST /surveys/{id}/invitations</c>, so an account
/// username and password would be a key the mode exists to deny, and an account invitation
/// would let its holder choose a password that opens every survey they are targeted by.
/// </summary>
public static class BulkImportDelivery
{
    /// <summary>An account INVITATION per person: a link to choose their own password.</summary>
    public const string Invitation = "invitation";

    /// <summary>An ACCOUNT username and password per person, mailed (mass invite, ruled 2026-10-13).</summary>
    public const string Credentials = "credentials";

    /// <summary>
    /// Nothing. The rows in <c>users</c> are created and no message leaves -- what
    /// <c>per_survey</c> needs, and the only delivery it has.
    /// </summary>
    public const string None = "none";
}

/// <param name="Demographics">
/// Pre-assigned demographic answers keyed by field, validated and stored exactly as a single
/// invitation's are (<c>DemographicValueValidation</c>, <c>user_invitation_demographics</c>) and
/// copied onto the person when they accept. Null from the CSV and template paths, which carry none.
/// </param>
public sealed record ParsedImportRow(
    int RowNumber,
    string Name,
    string Email,
    string Role,
    string? Department,
    IReadOnlyDictionary<string, string?>? Demographics = null);

/// <summary>
/// One row as the wizard hands it back after the admin has reviewed and possibly edited it.
///
/// <para>Every field is nullable because this is what a half-filled form posts, and a null here
/// must reach the same "Name is required" the CSV path produces rather than a 400 that names no
/// row. <see cref="RowNumber"/> is the row in the admin's own spreadsheet, carried through
/// untouched so the errors the screen shows can be found in the file they came from.</para>
/// </summary>
public sealed record BulkImportRowInput(
    int RowNumber,
    string? Name,
    string? Email,
    string? Role,
    string? Department,
    Dictionary<string, string?>? Demographics = null);

/// <param name="NewDepartments">
/// Departments the admin approved creating (the AI intake proposes them for areas the company
/// does not have yet). A row naming one is valid in preview and, on approval, the department is
/// created — once, and only if a row that is actually invited uses it.
/// </param>
/// <param name="WithCredentials">
/// Mass invite (ruled 2026-10-13): create each person's account now, with a generated username and
/// password emailed to them, instead of an invitation to choose their own. Their demographics go on
/// the account, so the survey never asks for them. A created row's status is <c>created</c>; one
/// whose email did not go out carries the issue <c>credentials_not_sent</c>.
///
/// <para>Refused with <c>credentials_not_available_per_survey</c> for a company in
/// <c>per_survey</c> mode, which has no account credentials to mail. Such a company's import
/// creates the accounts and sends nothing -- <see cref="BulkImportDelivery.None"/> -- whatever
/// this flag says, and the response's <c>Delivery</c> is where a caller reads which of the
/// three happened.</para>
/// </param>
public sealed record BulkImportRowsRequest(
    Guid CompanyId,
    bool Preview,
    IReadOnlyList<BulkImportRowInput>? Rows,
    IReadOnlyList<string>? NewDepartments = null,
    bool WithCredentials = false);
