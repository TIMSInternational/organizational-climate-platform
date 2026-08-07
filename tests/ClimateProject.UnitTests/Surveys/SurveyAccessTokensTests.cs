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

    [Fact]
    public void A_correctly_sized_token_with_an_illegal_character_is_rejected()
    {
        var token = SurveyAccessTokens.Mint();
        var tampered = string.Concat("%", token.AsSpan(1));

        Assert.Equal(SurveyAccessTokens.EncodedLength, tampered.Length);
        Assert.False(SurveyAccessTokens.HasExpectedShape(tampered));
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
