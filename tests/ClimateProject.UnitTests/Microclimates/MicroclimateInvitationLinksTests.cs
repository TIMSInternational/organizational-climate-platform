using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Microclimates;

/// <summary>
/// The path and the bytes of a microclimate invitation token (#130).
///
/// <para>
/// <b>The property under test is a round trip across two files.</b>
/// <c>MicroclimateInvitationEndpoints</c> mints a token with <c>Mint</c>, composes it into
/// mail through <c>LinkPath</c>, and then parses it back on the way in with
/// <c>HasExpectedShape</c>. Those are three separate calls in three separate places, and
/// nothing in the compiler says they agree. A minted token the shape check refuses is a mail
/// nobody can act on, delivered successfully, with every endpoint test still green because
/// they all read the token straight out of the table.
/// </para>
/// </summary>
public class MicroclimateInvitationLinksTests
{
    /// <summary>
    /// The literal three things have to agree on: this constant, the API's
    /// <c>/microclimate-invitations/{token}</c> route group, and the web app's
    /// <c>/microclimate-invitations/:token</c>. Only the first two are held together by a C#
    /// reference; the third is asserted in <c>web/src/app/router.test.ts</c>, because no
    /// reference crosses the language boundary and a rename breaks every link already sitting
    /// in an inbox.
    /// </summary>
    [Fact]
    public void The_link_prefix_is_the_literal_the_route_and_the_router_both_use()
    {
        Assert.Equal("/microclimate-invitations/", MicroclimateInvitationLinks.LinkPrefix);
        Assert.Equal("/microclimate-invitations/abc", MicroclimateInvitationLinks.LinkPath("abc"));
    }

    /// <summary>
    /// Site-relative, never absolute. Whoever emits one resolves it against the origin they
    /// are configured for (<c>EmailOptions.AppBaseUrl</c>), which is what stops staging mail
    /// from sending a recipient into production.
    /// </summary>
    [Fact]
    public void A_link_path_carries_no_host()
    {
        var path = MicroclimateInvitationLinks.LinkPath(MicroclimateInvitationLinks.Mint());

        Assert.StartsWith("/", path, StringComparison.Ordinal);
        Assert.DoesNotContain("://", path, StringComparison.Ordinal);
    }

    /// <summary>
    /// The round trip. Repeated, because a shape check that accepts 99 tokens in 100 fails on
    /// a schedule nobody can reproduce -- base64url's alphabet is where the padding and the
    /// <c>+</c>/<c>/</c> substitutions would show up, and only across many samples.
    /// </summary>
    [Fact]
    public void Every_minted_token_is_one_the_route_will_accept()
    {
        for (var i = 0; i < 500; i++)
        {
            var token = MicroclimateInvitationLinks.Mint();
            Assert.True(
                MicroclimateInvitationLinks.HasExpectedShape(token),
                $"minted token '{token}' would be refused by the route that has to parse it");
        }
    }

    /// <summary>
    /// Opaque and unpredictable: 500 tokens, 500 distinct values. Not a proof of entropy --
    /// that lives in <c>SurveyAccessTokens</c>, whose 256 bits from
    /// <c>RandomNumberGenerator</c> this delegates to -- but it is the assertion that would
    /// catch a "helpful" refactor to a counter or a GUID stringified.
    /// </summary>
    [Fact]
    public void Minted_tokens_do_not_repeat()
    {
        var minted = Enumerable.Range(0, 500).Select(_ => MicroclimateInvitationLinks.Mint()).ToList();

        Assert.Equal(minted.Count, minted.Distinct(StringComparer.Ordinal).Count());
        Assert.All(minted, token => Assert.Equal(SurveyAccessTokens.EncodedLength, token.Length));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("hello")]
    [InlineData("../../etc/passwd")]
    // Right length, wrong alphabet -- the two characters base64url substitutes away.
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa+")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/")]
    // Right alphabet, wrong length: one short and one long.
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public void A_token_that_is_not_ours_is_refused_before_the_index_lookup(string? token)
        => Assert.False(MicroclimateInvitationLinks.HasExpectedShape(token));

    /// <summary>
    /// The two link prefixes are different strings, so a survey token pasted into the
    /// microclimate route -- or a mail composed against the wrong constant -- lands nowhere
    /// rather than somewhere plausible.
    /// </summary>
    [Fact]
    public void The_two_invitation_link_prefixes_are_different()
        => Assert.NotEqual(
            SurveyAccessTokens.InvitationLinkPrefix,
            MicroclimateInvitationLinks.LinkPrefix);
}
