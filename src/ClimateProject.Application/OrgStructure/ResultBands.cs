using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// A company's result bands: the three areas a 1–5 mean is read in, in place of the single
/// "meta 3,7" the screens used to print.
/// </summary>
/// <remarks>
/// The scale is always 1,00 to 5,00 and the three areas are contiguous, so two numbers decide
/// it completely: where the opportunity area starts and where the strength area starts.
/// Storing a min and a max per band would let the database hold a gap or an overlap the UI
/// can never produce. A null name means "the product's default name in the reader's
/// language"; a company that renames an area stores the name it chose, verbatim.
///
/// The colours are NOT here and never will be: critical, opportunity and strength are the
/// product palette's red, amber and green tokens, so a colour means the same thing on every
/// tenant's screen.
/// </remarks>
public sealed record ResultBandsDto(
    decimal OpportunityMin,
    decimal StrengthMin,
    string? CriticalName,
    string? OpportunityName,
    string? StrengthName)
{
    public static ResultBandsDto From(CompanySettings settings) => new(
        settings.ResultBandOpportunityMin,
        settings.ResultBandStrengthMin,
        settings.ResultBandCriticalName,
        settings.ResultBandOpportunityName,
        settings.ResultBandStrengthName);
}

/// <summary>The whole scale, replaced at once: a half-written scale is not a scale.</summary>
public sealed record UpdateResultBandsRequest(
    decimal OpportunityMin,
    decimal StrengthMin,
    string? CriticalName,
    string? OpportunityName,
    string? StrengthName);

public static class ResultBandsValidation
{
    public const decimal ScaleMin = 1.00m;
    public const decimal ScaleMax = 5.00m;
    public const decimal Step = 0.01m;
    public const int MaxNameLength = 60;

    /// <summary>The reason the scale is refused, or <c>null</c> when it is a valid scale.</summary>
    /// <remarks>
    /// Each area must hold at least one value at two decimals: critical 1,00 up to
    /// <c>OpportunityMin - 0,01</c>, opportunity up to <c>StrengthMin - 0,01</c>, strength up
    /// to 5,00.
    /// </remarks>
    public static string? Validate(UpdateResultBandsRequest request)
    {
        if (decimal.Round(request.OpportunityMin, 2) != request.OpportunityMin
            || decimal.Round(request.StrengthMin, 2) != request.StrengthMin)
        {
            return "Band boundaries have at most two decimals";
        }

        if (request.OpportunityMin <= ScaleMin)
        {
            return "The critical area must hold at least one value above 1.00";
        }

        if (request.StrengthMin <= request.OpportunityMin)
        {
            return "The strength area must start above the opportunity area";
        }

        if (request.StrengthMin > ScaleMax)
        {
            return "The strength area must start at 5.00 or below";
        }

        foreach (var name in new[] { request.CriticalName, request.OpportunityName, request.StrengthName })
        {
            if (name is not null && name.Trim().Length > MaxNameLength)
            {
                return $"A band name has at most {MaxNameLength} characters";
            }
        }

        return null;
    }

    /// <summary>Writes a validated request onto the settings; a blank name returns to the default.</summary>
    public static void Apply(CompanySettings settings, UpdateResultBandsRequest request)
    {
        settings.ResultBandOpportunityMin = request.OpportunityMin;
        settings.ResultBandStrengthMin = request.StrengthMin;
        settings.ResultBandCriticalName = Normalise(request.CriticalName);
        settings.ResultBandOpportunityName = Normalise(request.OpportunityName);
        settings.ResultBandStrengthName = Normalise(request.StrengthName);
    }

    private static string? Normalise(string? name) => string.IsNullOrWhiteSpace(name) ? null : name.Trim();
}
