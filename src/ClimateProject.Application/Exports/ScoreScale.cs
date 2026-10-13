using System.Globalization;

namespace ClimateProject.Application.Exports;

/// <summary>
/// How a person reads a climate score: the 1,00–5,00 mean, or the same mean on 0–100
/// (mean × 20 — the client's EAGLE instrument answers on 20..100, so its bands 3,80 / 4,30
/// read 76 / 86).
/// </summary>
/// <remarks>
/// Only what a human reads converts. Storage, aggregation, the privacy floor and the result
/// bands' validation stay on 1–5 (see <c>ResultBandsValidation</c>), and the dashboard,
/// results and trends JSON keep the mean -- the web converts for display. The files a person
/// downloads convert here, because nobody downstream of a file can.
/// </remarks>
public enum ScoreScale
{
    Mean,
    Percent,
}

public static class ScoreScales
{
    public const string MeanKey = "mean";
    public const string PercentKey = "percent";

    /// <summary>The factor between a 1–5 mean and its 0–100 reading.</summary>
    public const decimal PercentFactor = 20m;

    /// <summary>True for a value a company's settings may hold.</summary>
    public static bool IsKnown(string? key) => key is MeanKey or PercentKey;

    /// <summary>A stored setting as a scale; anything unknown reads as the mean, which is every company's default.</summary>
    public static ScoreScale Parse(string? key) => key == PercentKey ? ScoreScale.Percent : ScoreScale.Mean;

    public static string Key(this ScoreScale scale) => scale == ScoreScale.Percent ? PercentKey : MeanKey;

    /// <summary>The CSV's summary value: "0-100" or "1-5".</summary>
    public static string RangeLabel(this ScoreScale scale) => scale == ScoreScale.Percent ? "0-100" : "1-5";

    /// <summary>
    /// A score for a machine-readable file, invariant culture: the mean as it is, or the mean × 20.
    /// Computed in <see cref="decimal"/> so 4.07 writes 81.4, never 81.39999999999999.
    /// </summary>
    public static string CsvNumber(this ScoreScale scale, double value)
    {
        if (scale == ScoreScale.Mean)
        {
            return value.ToString(CultureInfo.InvariantCulture);
        }

        var scaled = (decimal)value * PercentFactor;
        return scaled.ToString("0.############", CultureInfo.InvariantCulture);
    }

    /// <summary><see cref="CsvNumber"/> for an optional score: null stays empty, never 0.</summary>
    public static string? CsvNumber(this ScoreScale scale, double? value)
        => value is null ? null : scale.CsvNumber(value.Value);

    /// <summary>
    /// A score for a person to read, invariant culture (the caller localises the separator).
    /// </summary>
    /// <remarks>
    /// The mean prints as it always has: rounded to two decimals, trailing zeros dropped
    /// ("4,07", "4,1", "4"). On 0–100 the same number prints with ONE DECIMAL FEWER than the
    /// mean would have printed, so the reading claims no more precision than the mean did:
    /// 4,07 → "81,4", 4,1 → "82", 4 → "80".
    /// </remarks>
    public static string Display(this ScoreScale scale, double value)
    {
        if (scale == ScoreScale.Mean)
        {
            // Byte-for-byte what the exports printed before the scale existed.
            return Math.Round(value, 2).ToString("0.##", CultureInfo.InvariantCulture);
        }

        var mean = (decimal)Math.Round(value, 2);
        var meanDecimals = Decimals(mean);
        var percent = Math.Round(mean * PercentFactor, Math.Max(0, meanDecimals - 1), MidpointRounding.AwayFromZero);
        return percent.ToString("0.#", CultureInfo.InvariantCulture);
    }

    /// <summary>The decimals a value prints with once trailing zeros are dropped.</summary>
    private static int Decimals(decimal value)
    {
        var text = value.ToString("0.##", CultureInfo.InvariantCulture);
        var point = text.IndexOf('.', StringComparison.Ordinal);
        return point < 0 ? 0 : text.Length - point - 1;
    }
}
