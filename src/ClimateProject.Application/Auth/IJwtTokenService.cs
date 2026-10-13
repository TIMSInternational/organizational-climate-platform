namespace ClimateProject.Application.Auth;

public interface IJwtTokenService
{
    /// <param name="window">
    /// When the session began and when this token stops working, from
    /// <see cref="SessionWindows.Next"/>. A required parameter rather than a defaulted one:
    /// a default would silently restore the hardcoded 24-hour lifetime that
    /// <c>SystemSettings.SessionTimeoutMinutes</c> now replaces, and that regression would
    /// be invisible at the call site.
    /// </param>
    string IssueToken(TokenClaims claims, SessionWindow window);
}
