using ClimateProject.Infrastructure.Auth;

namespace ClimateProject.UnitTests.Auth;

public class BcryptPasswordHasherTests
{
    [Fact]
    public void Hash_produces_a_hash_that_Verify_accepts()
    {
        var hasher = new BcryptPasswordHasher();
        var hash = hasher.Hash("correct horse battery staple");

        Assert.True(hasher.Verify("correct horse battery staple", hash));
    }

    [Fact]
    public void Verify_rejects_wrong_password()
    {
        var hasher = new BcryptPasswordHasher();
        var hash = hasher.Hash("correct horse battery staple");

        Assert.False(hasher.Verify("wrong password", hash));
    }

    [Fact]
    public void Hash_uses_work_factor_12()
    {
        var hasher = new BcryptPasswordHasher();
        var hash = hasher.Hash("correct horse battery staple");

        Assert.StartsWith("$2", hash);
        Assert.Contains("$12$", hash);
    }

    // Every shape a corrupt or never-set credential column can take. Each of these
    // throws a DIFFERENT exception out of BCrypt.Verify — ArgumentException for empty,
    // SaltParseException for garbage, ArgumentOutOfRangeException for truncated,
    // ArgumentNullException for null — so this list is the guard's real specification.
    // An unparseable hash must fail authentication, never 500 the login endpoint.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-bcrypt-hash")]
    [InlineData("$2a$12$tooshort")]
    [InlineData("$9z$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")]
    public void Verify_rejects_unparseable_hash_rather_than_throwing(string? hash)
    {
        var hasher = new BcryptPasswordHasher();

        Assert.False(hasher.Verify("correct horse battery staple", hash!));
    }

    // The counterpart the guard must NOT swallow. A null password against a good hash
    // is a caller bug, and it throws the same ArgumentNullException a null hash does —
    // which is exactly why Verify guards the hash explicitly instead of catching
    // ArgumentException wholesale. If this ever starts returning false, the guard has
    // been widened too far and is hiding a defect.
    [Fact]
    public void Verify_still_throws_when_the_password_is_null()
    {
        var hasher = new BcryptPasswordHasher();
        var hash = hasher.Hash("correct horse battery staple");

        Assert.Throws<ArgumentNullException>(() => hasher.Verify(null!, hash));
    }
}
