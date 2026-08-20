namespace ClimateProject.Application.Surveys;

/// <summary>
/// The web app paths that name a survey, built from a survey id rather than typed out.
///
/// <para>
/// **Site-relative, never absolute.** Every value here is a path with no scheme and no host.
/// Whoever emits one resolves it against the origin *they* are configured for --
/// <c>EmailOptions.AppBaseUrl</c> for mail -- which is what stops staging mail from sending a
/// recipient into production, and what lets the same helper serve a stored column
/// (<c>survey_distributions.qr_code_url</c>) and an outbound email without either learning
/// about the other's origin. Nothing here may ever concatenate a host.
/// </para>
/// <para>
/// **One definition, because two producers already emit these paths.**
/// <c>SurveyDistributionEndpoints</c> stores <see cref="Survey"/> in <c>qr_code_url</c>, and
/// <see cref="Respond"/> is what a survey invitation email links to. Those are different
/// files in different projects, and a literal in each is how a route rename ships green:
/// nothing in a compiler or a test suite connects <c>"/surveys/"</c> in one file to
/// <c>"/surveys/"</c> in another. Referenced through this class they move together.
/// </para>
/// <para>
/// **What this cannot guarantee.** The web app declares these routes in
/// <c>web/src/app/router.tsx</c>, a TypeScript file no C# reference can reach, so renaming a
/// route there still breaks a mailed link and no .NET test will notice. This class narrows
/// the drift to that one crossing instead of scattering it across every producer; it does not
/// close it. Say so rather than implying a guarantee that stops at the language boundary.
/// </para>
/// </summary>
public static class SurveyWebPaths
{
    /// <summary>Path prefix every survey-scoped screen hangs off.</summary>
    public const string Prefix = "/surveys/";

    /// <summary>
    /// The segment that turns a survey's page into the form an invitee answers. Declared in
    /// the web app as <c>/surveys/:id/respond</c>, deliberately outside <c>AdminLayout</c>, so
    /// an invitee who follows a mailed link does not land inside the administrator's rail.
    /// </summary>
    public const string RespondSuffix = "/respond";

    /// <summary>A survey's own page. What <c>qr_code_url</c> falls back to with no share link.</summary>
    public static string Survey(Guid surveyId) => Prefix + surveyId;

    /// <summary>
    /// Where an invitee goes to take part -- the destination of the link a survey invitation
    /// email promises.
    ///
    /// Takes a <see cref="Guid"/> rather than a string on purpose. The id reaching a composer
    /// comes out of <c>notifications.data</c>, a jsonb column <c>POST /notifications</c> lets
    /// a company admin write verbatim; parsing to a <see cref="Guid"/> and re-rendering *that*
    /// means the path is built from 16 bytes, not from caller text, so no payload can append a
    /// segment, a query string or a quote to a URL mailed under this platform's own domain.
    /// A <c>string</c> overload would make that failure available again, so there isn't one.
    /// </summary>
    public static string Respond(Guid surveyId) => Survey(surveyId) + RespondSuffix;
}
