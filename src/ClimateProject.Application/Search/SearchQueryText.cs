using System.Globalization;
using System.Text;

namespace ClimateProject.Application.Search;

/// <summary>
/// Turns whatever a human typed into a <c>tsquery</c> string.
///
/// Two properties matter here and both are load-bearing.
///
/// **It cannot fail.** <c>to_tsquery</c> raises a syntax error on unbalanced parentheses,
/// a trailing <c>&amp;</c>, a bare <c>!</c> and several other shapes a person types by
/// accident ("q&amp;a", "(draft"). A 500 on a keystroke is unacceptable for type-ahead, so
/// this builds the query from scratch out of nothing but letters and digits rather than
/// trying to sanitise the operators the user typed. Everything else is a separator.
///
/// **It cannot inject.** The output is passed to <c>to_tsquery</c> as a bound parameter,
/// so it was never SQL to begin with -- but the tsquery language has its own operators
/// (<c>&amp;</c>, <c>|</c>, <c>!</c>, <c>&lt;-&gt;</c>) and letting a caller supply them
/// would let them turn an AND-search into an OR-search, widening a result set the
/// permission filter deliberately narrowed. Stripping to letters and digits removes that
/// surface entirely.
///
/// Every term gets the <c>:*</c> prefix marker. That is what makes the same index serve
/// both the results page and type-ahead: "encue" has to find "Encuesta" while the user is
/// still typing, and prefix matching is also how this design recovers most of what a
/// stemmer would give -- see <c>SearchIndexConfiguration</c> for why the index is built with the
/// <c>simple</c> configuration and does no stemming at all.
/// </summary>
public static class SearchQueryText
{
    /// <summary>
    /// Terms beyond this are dropped. Each term is another AND-ed index probe, and a
    /// pasted paragraph would otherwise turn one keystroke into hundreds of them.
    /// </summary>
    public const int MaxTerms = 8;

    /// <summary>
    /// Longer terms are truncated rather than dropped. Truncating keeps the match (the
    /// result is still a prefix query) where dropping would silently lose a filter.
    /// </summary>
    public const int MaxTermLength = 64;

    /// <summary>
    /// A term shorter than this is ignored. A single-letter prefix matches a large
    /// fraction of the index, which is a scan dressed up as a search.
    /// </summary>
    public const int MinTermLength = 2;

    /// <summary>
    /// The tsquery text, or null when <paramref name="raw"/> contains no usable term.
    /// A null result means "do not run a search", never "match everything".
    /// </summary>
    public static string? ToPrefixQuery(string? raw)
    {
        var terms = Terms(raw);
        if (terms.Count == 0)
        {
            return null;
        }

        return string.Join(" & ", terms.Select(t => t + ":*"));
    }

    /// <summary>
    /// The normalised terms, exposed so the tests can pin the tokenisation independently
    /// of the tsquery syntax wrapped around it.
    /// </summary>
    public static IReadOnlyList<string> Terms(string? raw)
    {
        var terms = new List<string>();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return terms;
        }

        var current = new StringBuilder();

        void Flush()
        {
            if (current.Length >= MinTermLength && terms.Count < MaxTerms)
            {
                var term = current.ToString();
                if (!terms.Contains(term, StringComparer.Ordinal))
                {
                    terms.Add(term);
                }
            }

            current.Clear();
        }

        foreach (var ch in raw)
        {
            // Letters and digits only, and IsLetterOrDigit is Unicode-aware, so "Gestión"
            // and "año" survive intact. Accents are preserved rather than folded: folding
            // needs the unaccent extension, which is not installed -- see SearchIndexConfiguration.
            if (char.IsLetterOrDigit(ch))
            {
                if (current.Length < MaxTermLength)
                {
                    current.Append(char.ToLower(ch, CultureInfo.InvariantCulture));
                }

                continue;
            }

            Flush();
        }

        Flush();
        return terms;
    }
}
