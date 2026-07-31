namespace ClimateProject.Application.Auth;

public interface IJwtTokenService
{
    string IssueToken(TokenClaims claims);
}
