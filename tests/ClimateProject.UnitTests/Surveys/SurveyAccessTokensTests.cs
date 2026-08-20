using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The two bearer tokens on the distribution surface. These are credentials for
/// unauthenticated routes, so "not guessable" and "fits the column" are both correctness
/// properties, not hygiene.
/// </summary>
public class SurveyAccessTokensTests
{
    [Fact]
    public void A_minted_token_is_url_safe_and_the_expected_length()
    {
        var token = SurveyAccessTokens.Mint();

        Assert.Equal(SurveyAccessTokens.EncodedLength, token.Length);
        Assert.True(SurveyAccessTokens.HasExpectedShape(token));

        // base64url, unpadded: no '+', '/' or '=' to survive a URL, a mail client's link
        // rewriter, or a route segment.
        Assert.DoesNotContain('+', token);
        Assert.DoesNotContain('/', token);
        Assert.DoesNotContain('=', token);
    }

    [Fact]
    public void A_minted_token_fits_the_two_hundred_and_fifty_five_character_column()
    {
        // survey_invitations.invitation_token is character varying(255), and
        // survey_distributions.public_url is character varying(500) once prefixed.
        Assert.True(SurveyAccessTokens.Mint().Length <= 255);
        Assert.True(SurveyAccessTokens.PublicLinkPath(SurveyAccessTokens.Mint()).Length <= 500);
    }

    [Fact]
    public void Minting_carries_the_full_entropy_budget()
    {
        // 32 bytes -> ceil(32 * 8 / 6) = 43 unpadded base64 characters. If someone shrinks
        // EntropyBytes, this fails rather than silently weakening every share link.
        Assert.Equal(32, SurveyAccessTokens.EntropyBytes);
        Assert.Equal(43, SurveyAccessTokens.EncodedLength);
    }

    [Fact]
    public void Two_thousand_tokens_are_all_distinct()
    {
        // Not a randomness test -- it is a regression guard against a constant, a counter, or
        // a seeded RNG being substituted for the crypto one. Any of those collapse this set.
        var tokens = Enumerable.Range(0, 2000).Select(_ => SurveyAccessTokens.Mint()).ToHashSet(StringComparer.Ordinal);
        Assert.Equal(2000, tokens.Count);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("../../etc/passwd")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]   // 42: one short
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]  // 44: one long
    public void Obvious_rubbish_is_rejected_before_it_reaches_the_index(string? candidate)
        => Assert.False(SurveyAccessTokens.HasExpectedShape(candidate));

    [Theory]
    // Path separators and traversal. `/s/` and `/survey-invitations/` put this value straight
    // into a URL path, so any of these getting through is a traversal, not a tidiness lapse.
    [InlineData('/')]
    [InlineData('.')]
    [InlineData('\\')]
    // Standard-base64 characters. This alphabet is base64*url*; admitting these means a token
    // minted for one encoding is accepted under another, and '+' is a space once a mail client
    // or a form decoder has been through the URL.
    [InlineData('+')]
    [InlineData('=')]
    // Query, fragment and escaping -- the rest of the URL grammar.
    [InlineData('?')]
    [InlineData('#')]
    [InlineData('&')]
    [InlineData('%')]
    [InlineData(':')]
    [InlineData('@')]
    // Markup and quoting, for the composer that renders a link built on this into HTML.
    [InlineData('<')]
    [InlineData('"')]
    [InlineData('\'')]
    // Whitespace and control characters, which trim and split differently at every layer.
    [InlineData(' ')]
    [InlineData('\t')]
    [InlineData('\n')]
    [InlineData('\0')]
    // Non-ASCII, where casing and normalisation stop being one-to-one.
    [InlineData('é')]
    [InlineData('İ')]
    public void A_correctly_sized_token_with_an_illegal_character_is_rejected(char illegal)
    {
        // Deliberately a theory over the whole disallowed grammar rather than one '%'. With a
        // single character probed, a check that quietly admitted '.', '/' and '+' -- the three
        // that actually enable traversal and encoding confusion -- passed this file and the
        // entire suite. One character proves that *a* filter exists, not that it is the right
        // one.
        var token = SurveyAccessTokens.Mint();

        // At the front, in the middle, and at the end: a loop that stops early, or one that
        // skips the first or last index, is a real off-by-one and is invisible to a fixture
        // that only ever tampers with position zero.
        foreach (var tampered in new[]
                 {
                     string.Concat(illegal.ToString(), token.AsSpan(1)),
                     string.Concat(token.AsSpan(0, 21), illegal.ToString(), token.AsSpan(22)),
                     string.Concat(token.AsSpan(0, SurveyAccessTokens.EncodedLength - 1), illegal.ToString()),
                 })
        {
            Assert.Equal(SurveyAccessTokens.EncodedLength, tampered.Length);
            Assert.False(SurveyAccessTokens.HasExpectedShape(tampered));
        }
    }

    [Fact]
    public void Every_character_a_minted_token_can_contain_is_accepted()
    {
        // The other half: a check tightened until it rejects real tokens is just as broken as
        // one that admits rubbish, and nothing above would notice. base64url's alphabet is
        // A-Z, a-z, 0-9, '-' and '_' -- all 64 of them, each in a correctly sized token.
        const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

        foreach (var legal in Alphabet)
        {
            var token = new string(legal, SurveyAccessTokens.EncodedLength);

            Assert.True(SurveyAccessTokens.HasExpectedShape(token), $"'{legal}' is base64url and must be accepted.");
        }
    }

    [Fact]
    public void A_public_link_is_a_site_relative_path_and_not_an_absolute_url()
    {
        var path = SurveyAccessTokens.PublicLinkPath("abc");

        // public_url is uniquely indexed. Baking a host into it would make the same link two
        // different rows across two origins, and one broken uniqueness guarantee.
        Assert.Equal("/s/abc", path);
        Assert.StartsWith("/", path, StringComparison.Ordinal);
        Assert.DoesNotContain("://", path, StringComparison.Ordinal);
    }

    [Fact]
    public void A_user_invitation_token_is_not_mistaken_for_a_survey_one()
    {
        // InvitationEndpoints mints 32-char hex GUIDs. The shape check is what stops one
        // surface's token being probed against the other's lookup.
        Assert.False(SurveyAccessTokens.HasExpectedShape(Guid.NewGuid().ToString("N")));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("private", false)]
    [InlineData("tokenized", true)]
    [InlineData("public", true)]
    public void The_access_type_vocabulary_is_exactly_two_values(string? accessType, bool expected)
    {
        Assert.Equal(expected, SurveyAccessTypes.IsValid(accessType));
        Assert.Equal(2, SurveyAccessTypes.All.Length);
        Assert.All(SurveyAccessTypes.All, value => Assert.True(value.Length <= 20, value));
    }
}
