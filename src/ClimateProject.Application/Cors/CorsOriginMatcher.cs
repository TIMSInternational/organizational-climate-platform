namespace ClimateProject.Application.Cors;

public sealed class CorsOriginMatcher
{
    private readonly IReadOnlyCollection<string> _exactOrigins;
    private readonly IReadOnlyList<(string Prefix, string Suffix)> _wildcardPatterns;

    public CorsOriginMatcher(IEnumerable<string> exactOrigins, IEnumerable<string> wildcardOrigins)
    {
        _exactOrigins = exactOrigins.ToArray();
        _wildcardPatterns = wildcardOrigins
            .Select(pattern =>
            {
                var starIndex = pattern.IndexOf('*');
                if (starIndex < 0)
                {
                    throw new ArgumentException(
                        $"Wildcard origin pattern '{pattern}' must contain '*'.",
                        nameof(wildcardOrigins));
                }

                return (Prefix: pattern[..starIndex], Suffix: pattern[(starIndex + 1)..]);
            })
            .ToList();
    }

    public bool IsAllowed(string origin)
    {
        if (_exactOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            return true;
        }

        return _wildcardPatterns.Any(pattern =>
            origin.StartsWith(pattern.Prefix, StringComparison.OrdinalIgnoreCase)
            && origin.EndsWith(pattern.Suffix, StringComparison.OrdinalIgnoreCase));
    }
}
