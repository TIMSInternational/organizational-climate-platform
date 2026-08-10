using System.Runtime.CompilerServices;

namespace ClimateProject.UnitTests.Auth;

/// #280 put the deactivation guard inside AuthEndpoints.IssueTokenForAsync and documented it
/// as "the single place this API mints a token". That claim was not true when it was written:
/// InvitationAcceptEndpoints built its own TokenClaims and never went through the helper, so
/// the guard was not in fact unavoidable. It is true now -- and a comment cannot keep it true.
///
/// This is a source-text guard, not a behavioural test, because the failure it catches has no
/// behaviour to observe: a new endpoint that mints its own token for an active user behaves
/// exactly like one that goes through the helper. What differs is only what happens the day
/// someone deactivates that user, which is the bug #280 was filed for.
///
/// If this fails: do not add your file to an exemption list. Call
/// AuthEndpoints.IssueTokenForAsync instead -- it takes the refusal your path should give.
public class SingleTokenMintSiteTests
{
    // Matched with the leading dot on purpose: that makes it a *call* on some IJwtTokenService
    // instance whatever the variable is named, and it does not match the declaration in
    // IJwtTokenService.cs or the implementation in JwtTokenService.cs, neither of which needs
    // an exemption entry that would then have to be maintained.
    private const string MintingCall = ".IssueToken(";
    private const string TheOneAllowedFile = "AuthEndpoints.cs";

    [Fact]
    public void Only_AuthEndpoints_mints_a_token()
    {
        var src = Path.Combine(RepositoryRoot(), "src");
        Assert.True(Directory.Exists(src), $"Expected a src directory at {src}");

        var offenders = Directory
            .EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(path => Path.GetFileName(path) != TheOneAllowedFile)
            .Where(path => File.ReadAllText(path).Contains(MintingCall, StringComparison.Ordinal))
            .Select(path => Path.GetRelativePath(src, path))
            .Order()
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"These files mint a JWT without going through AuthEndpoints.IssueTokenForAsync, so the "
            + $"deactivation guard added in #280 does not cover them: {string.Join(", ", offenders)}");
    }

    /// The guard reads the checked-out sources, so it needs the repo root rather than the test
    /// binary's directory (bin/Debug/net10.0, whose depth is a build detail). Anchored on the
    /// compile-time path of this file and walked up to the solution file -- correct wherever
    /// the repo is cloned, and it fails loudly instead of silently scanning nothing.
    private static string RepositoryRoot([CallerFilePath] string thisFile = "")
    {
        var dir = Directory.GetParent(thisFile);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "ClimateProject.slnx")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return dir.FullName;
    }
}
