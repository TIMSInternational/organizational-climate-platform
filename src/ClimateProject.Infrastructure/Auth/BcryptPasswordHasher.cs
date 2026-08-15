using ClimateProject.Application.Auth;

namespace ClimateProject.Infrastructure.Auth;

public class BcryptPasswordHasher : IPasswordHasher
{
    private const int WorkFactor = 12;

    public string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password, WorkFactor);

    // A stored hash we cannot parse is a corrupt or never-set credential, not a server
    // fault: the honest answer is "these do not match", not a 500 on the login path.
    // BCrypt signals unparseable input four different ways depending on how the value is
    // malformed, so keying on SaltParseException alone misses half of them:
    //
    //   ""                  ArgumentException            (likeliest value in a real column)
    //   "   " / garbage     SaltParseException
    //   "$2a$12$tooshort"   ArgumentOutOfRangeException
    //   null                ArgumentNullException
    //
    // The null/empty guard comes first and deliberately does the work that a blanket
    // `catch (ArgumentException)` would: a null *password* against a valid hash throws
    // ArgumentNullException too, and that is a caller bug which must stay loud rather
    // than be silently reported as a failed login.
    public bool Verify(string password, string hash)
    {
        if (string.IsNullOrWhiteSpace(hash))
        {
            return false;
        }

        try
        {
            return BCrypt.Net.BCrypt.Verify(password, hash);
        }
        catch (BCrypt.Net.SaltParseException)
        {
            return false;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }
}
