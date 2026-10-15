using System.Security.Cryptography;
using System.Text;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// The session id an ANONYMOUS survey gives a signed-in respondent, derived rather than stored.
/// </summary>
/// <remarks>
/// <para>
/// An anonymous response carries no <c>user_id</c> -- <c>SurveyResponseEndpoints.Respondent
/// .StoredUserId</c> returns null for one, so the answers cannot be joined to a person and
/// cannot acquire the means to be later. The handle that makes resuming possible anyway is this
/// id, written into <c>responses.session_id</c>: 32 lower-case hex characters, the shape and
/// length of the random ids it sits beside, so nothing downstream can tell a derived id from a
/// generated one.
/// </para>
/// <para>
/// <b>Why keyed.</b> Resuming at all means the server must find a person's own response, which
/// is a link however it is built. Keyed, only something holding the key can compute it: a reader
/// with the database alone sees an opaque token, where a <c>user_id</c> column would hand them
/// the join outright. A weaker promise than no link at all, a stronger one than an identified
/// survey, and the trade the 2026-10-15 ruling took knowingly.
/// </para>
/// <para>
/// <b>Why it lives here rather than beside the respond flow.</b> Two surfaces need the same
/// derivation and must agree to the byte: the respond flow, which looks a person's own partial
/// up so they can carry on, and the roster, which asks only whether such a partial EXISTS so an
/// administrator can tell "has not opened it" from "was interrupted". Two copies of an HMAC
/// input string are one edit away from silently disagreeing, and the failure would be a
/// respondent losing their answers.
/// </para>
/// <para>
/// <b>What the roster's use does NOT add.</b> It is strictly less than resuming already does.
/// The respond flow computes this id, finds the response and hands its ANSWERS back to the
/// person. The roster computes the same id and reads whether a row is there and whether it is
/// complete -- no answer, no score, no text. Anything that can do the second could already do
/// the first, so showing "started and stopped" costs nothing that resume has not already spent.
/// </para>
/// </remarks>
public static class SurveyResumeSession
{
    /// <summary>
    /// The configuration key, and the one it falls back to so a deployment gets this without
    /// new configuration. <c>TrackingJwtSecret</c> is required for the API to start at all
    /// (<c>Program.cs</c> throws without it), so in any running environment a key exists.
    /// </summary>
    public const string KeyName = "SurveyResumeKey";

    /// <inheritdoc cref="KeyName"/>
    public const string FallbackKeyName = "TrackingJwtSecret";

    /// <summary>
    /// The derived id, or null when no key is configured -- in which case the behaviour
    /// everywhere is exactly what it was before any of this existed: the respond flow falls
    /// back to the browser's own id, and the roster cannot tell a stopped respondent from an
    /// absent one and says so rather than guessing.
    /// </summary>
    public static string? IdFor(Guid surveyId, Guid userId, string? key)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return null;
        }

        using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(key));

        // v1 and the two ids in "N" format. The version prefix is not decoration: it is what
        // lets the input change one day without every partial in flight becoming unfindable.
        var digest = mac.ComputeHash(Encoding.UTF8.GetBytes($"survey-resume-v1:{surveyId:N}:{userId:N}"));
        return Convert.ToHexString(digest)[..32].ToLowerInvariant();
    }
}
