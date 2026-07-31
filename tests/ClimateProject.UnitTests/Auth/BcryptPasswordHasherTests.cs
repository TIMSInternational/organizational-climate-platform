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
}
