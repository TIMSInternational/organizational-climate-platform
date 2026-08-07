using System.Security.Cryptography;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// Minting and shape-checking for the two bearer tokens on the distribution surface: a
/// per-invitee <c>survey_invitations.invitation_token</c>, and the opaque token embedded in
/// <c>survey_distributions.public_url</c>.
///
/// Both are bearer credentials for an unauthenticated route, so they are treated the way the
/// security audit already treats <c>invitation_token</c> columns: never logged, never
/// returned on a listing, and never derived from anything a caller can predict.
///
/// <para>
/// Deliberately NOT <c>Guid.NewGuid().ToString("N")</c>, which is what
/// <c>InvitationEndpoints</c> uses for user invitations. A v4 GUID carries 122 bits of
/// randomness with 6 fixed bits, and its generator is not documented as cryptographic on
/// every platform. That is defensible for a token mailed to one named address that dies on
/// first acceptance; it is a weaker basis for a share link that may sit in a mailbox for the
/// length of a survey window. 32 bytes from <see cref="RandomNumberGenerator"/> costs
/// nothing and removes the question. The existing user-invitation tokens are left alone --
/// changing them is not this surface's call to make.
/// </para>
/// </summary>
public static class SurveyAccessTokens
{
    /// <summary>256 bits. Comfortably beyond guessing, and 43 base64url characters -- well inside <c>varchar(255)</c>.</summary>
    public const int EntropyBytes = 32;

    /// <summary>Length of a minted token once base64url-encoded and stripped of padding.</summary>
    public const int EncodedLength = 43;

    /// <summary>
    /// The path prefix a public share link is stored under in
    /// <c>survey_distributions.public_url</c>. Stored as a site-relative path rather than an
    /// absolute URL: the column is uniquely indexed, and baking a host into it would mean the
    /// same link stored under two different origins (staging and production, or before and
    /// after a domain change) is two different rows and one broken index.
    /// </summary>
    public const string PublicLinkPrefix = "/s/";

    /// <summary>A fresh, opaque, cryptographically random token.</summary>
    public static string Mint() => Encode(RandomNumberGenerator.GetBytes(EntropyBytes));

    /// <summary>The value stored in <c>public_url</c> for a given share token.</summary>
    public static string PublicLinkPath(string token) => PublicLinkPrefix + token;

    /// <summary>
    /// Whether a caller-supplied token even looks like one of ours.
    ///
    /// Purely a cheap reject for garbage: it lets an unauthenticated route drop a 10KB route
    /// segment before it reaches a <c>varchar(255)</c> index lookup. It discloses nothing --
    /// the encoding is public -- and it is never used in place of the real lookup.
    /// </summary>
    public static bool HasExpectedShape(string? token)
    {
        if (token is null || token.Length != EncodedLength)
        {
            return false;
        }

        foreach (var character in token)
        {
            var isAllowed = character is >= 'A' and <= 'Z'
                            || character is >= 'a' and <= 'z'
                            || character is >= '0' and <= '9'
                            || character is '-' or '_';
            if (!isAllowed)
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// base64url (RFC 4648 §5), unpadded. Hand-rolled rather than pulled from
    /// <c>Microsoft.AspNetCore.WebUtilities</c> so this stays in Application with no web
    /// dependency, which is what lets it be unit-tested without a host.
    /// </summary>
    private static string Encode(byte[] bytes)
        => Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}

/// <summary>
/// <c>survey_distributions.access_type</c>'s vocabulary.
///
/// Two values, not more, and the reason matters: the column distinguishes exactly one thing
/// the rest of the row cannot express -- whether an open share link exists alongside the
/// per-invitee tokens. Everything finer (must the visitor log in, may they answer
/// anonymously, one response or many) is already stored, and validated, on
/// <c>access_rules</c>. Restating any of it here is how two columns come to disagree about
/// the same fact, and the one that loses is whichever the next reader forgets.
///
/// The legacy schema notes call this an enum but never record its members
/// (<c>docs/legacy-issues/climate-project-issues.md</c>), and the DDL has no CHECK
/// constraint -- only a <c>tokenized</c> default. So this is the vocabulary, derived from
/// what the columns can actually mean rather than guessed at from a name.
/// </summary>
public static class SurveyAccessTypes
{
    /// <summary>Per-invitee tokens only. No public link exists; <c>public_url</c> is NULL. The DDL default.</summary>
    public const string Tokenized = "tokenized";

    /// <summary>An open share link exists. Per-invitee invitations still work alongside it.</summary>
    public const string Public = "public";

    public static readonly string[] All = [Tokenized, Public];

    public static bool IsValid(string? accessType)
        => accessType is not null && Array.IndexOf(All, accessType) >= 0;
}
