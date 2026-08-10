using ClimateProject.Application.Search;

namespace ClimateProject.UnitTests.Search;

/// <summary>
/// The tsquery builder. Two failures matter and both are covered here: a shape that makes
/// <c>to_tsquery</c> raise (a 500 on a keystroke), and a shape that lets the caller supply
/// tsquery operators of their own (an OR where the permission filter assumed an AND).
/// </summary>
public class SearchQueryTextTests
{
    [Theory]
    [InlineData("clima", "clima:*")]
    [InlineData("Clima", "clima:*")]
    [InlineData("  clima  ", "clima:*")]
    [InlineData("clima laboral", "clima:* & laboral:*")]
    [InlineData("clima  laboral", "clima:* & laboral:*")]
    public void Every_term_becomes_a_prefix_term_so_type_ahead_matches_a_half_typed_word(string input, string expected)
        => Assert.Equal(expected, SearchQueryText.ToPrefixQuery(input));

    [Theory]
    [InlineData("Gestión", "gestión:*")]
    [InlineData("año", "año:*")]
    [InlineData("Encuesta de Satisfacción", "encuesta:* & de:* & satisfacción:*")]
    public void Accented_spanish_words_survive_tokenisation(string input, string expected)
        => Assert.Equal(expected, SearchQueryText.ToPrefixQuery(input));

    [Theory]
    // Every one of these makes to_tsquery raise a syntax error if it is passed through.
    [InlineData("q&a")]
    [InlineData("(draft")]
    [InlineData("engagement |")]
    [InlineData("!")]
    [InlineData("a <-> b")]
    [InlineData("'quoted'")]
    [InlineData(":*")]
    [InlineData("&&&")]
    public void Operator_characters_never_reach_the_query(string input)
    {
        var query = SearchQueryText.ToPrefixQuery(input);
        if (query is null)
        {
            return;
        }

        // The only punctuation the output may contain is the syntax this builder itself
        // emits: the ":*" prefix marker and the " & " separator.
        var stripped = query.Replace(":*", string.Empty, StringComparison.Ordinal)
                            .Replace(" & ", " ", StringComparison.Ordinal);
        Assert.All(stripped, ch => Assert.True(char.IsLetterOrDigit(ch) || ch == ' ', $"'{ch}' leaked from \"{input}\" into \"{query}\""));
    }

    [Fact]
    public void An_or_operator_cannot_be_smuggled_in_to_widen_the_result_set()
    {
        // "a | b" as an OR would return rows matching only "b". Turning it into an AND of
        // two prefixes is the conservative reading and the one the caller's permission
        // filter was sized for.
        Assert.Equal("aa:* & bb:*", SearchQueryText.ToPrefixQuery("aa | bb"));
        Assert.DoesNotContain("|", SearchQueryText.ToPrefixQuery("aa | bb")!, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("!!!")]
    [InlineData("a")]
    [InlineData("a b")]
    public void A_term_with_nothing_searchable_in_it_is_null_and_never_a_match_everything(string? input)
        => Assert.Null(SearchQueryText.ToPrefixQuery(input));

    [Fact]
    public void A_single_letter_is_dropped_but_a_longer_term_beside_it_is_kept()
    {
        // "a" alone would prefix-match a large fraction of the index -- a scan dressed up
        // as a search. Dropping it must not drop the term that makes the query selective.
        Assert.Equal("survey:*", SearchQueryText.ToPrefixQuery("a survey"));
    }

    [Fact]
    public void Repeated_terms_are_collapsed_rather_than_and_ed_with_themselves()
        => Assert.Equal("clima:*", SearchQueryText.ToPrefixQuery("clima clima CLIMA"));

    [Fact]
    public void A_pasted_paragraph_is_capped_so_one_keystroke_is_not_dozens_of_index_probes()
    {
        var pasted = string.Join(' ', Enumerable.Range(0, 40).Select(i => $"term{i}"));

        var terms = SearchQueryText.Terms(pasted);

        Assert.Equal(SearchQueryText.MaxTerms, terms.Count);
        Assert.Equal("term0", terms[0]);
    }

    [Fact]
    public void An_absurdly_long_term_is_truncated_rather_than_dropped()
    {
        var term = new string('x', SearchQueryText.MaxTermLength + 50);

        var terms = SearchQueryText.Terms(term);

        // Truncating keeps it a prefix query, so the match survives. Dropping it would
        // silently lose a filter the caller typed.
        Assert.Equal(SearchQueryText.MaxTermLength, Assert.Single(terms).Length);
    }
}
