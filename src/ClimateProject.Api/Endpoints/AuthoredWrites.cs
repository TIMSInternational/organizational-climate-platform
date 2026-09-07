using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// One field's two halves after a write, or the 400 that refused it.
/// </summary>
internal readonly record struct AppliedPair(string? En, string? Es, IResult? Error);

/// <summary>
/// The write side of #210's paired columns, for the endpoints that own them.
///
/// One implementation of "which language does a bare string land in", so the seven
/// endpoint files that accept these fields cannot drift apart on it. The rule itself lives
/// in <see cref="AuthoredContent.AttributionLocale"/>; this class only fetches the two
/// signals that need the database -- the owning company's language and, when that names no
/// single language, the author's display language -- and stops as soon as one answers.
/// </summary>
internal static class AuthoredWrites
{
    /// <summary>
    /// The locale a bare string is filed under for content owned by <paramref name="companyId"/>
    /// (null for a global row) and authored by <paramref name="currentUser"/>.
    /// </summary>
    /// <param name="declaredLanguage">
    /// The language the request declares, where the request has such a field
    /// (<c>CreateSurveyTemplateRequest.Language</c>), or the language an existing row is
    /// already authored in (<see cref="AuthoredContent.LanguageOf"/>) on an update -- so
    /// editing a Spanish template with bare strings keeps writing Spanish. Null otherwise.
    /// </param>
    public static async Task<string> AttributionLocaleAsync(
        ClimateProjectDbContext db,
        CurrentUser currentUser,
        Guid? companyId,
        string? declaredLanguage,
        CancellationToken cancellationToken)
    {
        if (ContentLanguages.SingleLocaleOf(declaredLanguage) is string declared)
        {
            return declared;
        }

        string? companyLanguage = null;
        if (companyId is not null)
        {
            companyLanguage = await db.Companies
                .Where(c => c.Id == companyId.Value)
                .Select(c => c.Settings.Language)
                .FirstOrDefaultAsync(cancellationToken);
        }

        return await AttributionLocaleForLanguagesAsync(db, currentUser, declaredLanguage, companyLanguage, cancellationToken);
    }

    /// <summary>
    /// <see cref="AttributionLocaleAsync"/> for a caller that already holds the company's
    /// language, so the row is not read twice.
    /// </summary>
    public static async Task<string> AttributionLocaleForLanguagesAsync(
        ClimateProjectDbContext db,
        CurrentUser currentUser,
        string? declaredLanguage,
        string? companyLanguage,
        CancellationToken cancellationToken)
    {
        if ((ContentLanguages.SingleLocaleOf(declaredLanguage) ?? ContentLanguages.SingleLocaleOf(companyLanguage)) is string single)
        {
            return single;
        }

        // Only reached for a global row, or a company set to 'both': one more read, and
        // only when the cheaper signals had nothing to say.
        var displayLanguage = await ActingUserResolver.ResolveDisplayLanguageAsync(currentUser, db, cancellationToken);
        return AuthoredContent.AttributionLocale(declaredLanguage, companyLanguage, displayLanguage);
    }

    /// <summary>
    /// Applies <paramref name="input"/> over the current halves and refuses the result when
    /// a required field would end up authored in no language.
    /// </summary>
    public static AppliedPair Apply(
        LocalizedInput? input,
        string attributionLocale,
        string fieldName,
        string requiredMessage,
        bool required,
        string? currentEn,
        string? currentEs)
    {
        var en = currentEn;
        var es = currentEs;
        if (!AuthoredContent.TryApply(input, attributionLocale, fieldName, ref en, ref es, out var error))
        {
            return new AppliedPair(currentEn, currentEs, Results.Json(new { message = error }, statusCode: 400));
        }

        if (required && !AuthoredContent.IsAuthored(en, es))
        {
            return new AppliedPair(currentEn, currentEs, Results.Json(new { message = requiredMessage }, statusCode: 400));
        }

        return new AppliedPair(en, es, null);
    }

    /// <summary>
    /// True for a bare string that is empty or whitespace. The update routes that used to
    /// ignore such a value (<c>if (!string.IsNullOrWhiteSpace(request.Title))</c>) keep
    /// ignoring it, so a form that echoes an untouched field back as "" does not clear it.
    /// </summary>
    public static bool IsBlankBare(LocalizedInput? input)
        => input is { ByLocale: null } && string.IsNullOrWhiteSpace(input.Bare);

    /// <summary>
    /// Both halves of an existing row as an explicit locale-keyed input, for the
    /// instantiation routes that used to fall back to a bare <c>template.Name</c>. Carrying
    /// the pair as a pair is what stops a bilingual template's name from being filed under
    /// one language, or refused, when it becomes a survey's title.
    /// </summary>
    public static LocalizedInput AsInput(string? en, string? es)
        => LocalizedInput.FromLocales(new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            [ContentLanguages.English] = en,
            [ContentLanguages.Spanish] = es,
        });
}
