using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Auth;

public class TemporaryPasswordsTests
{
    private static PasswordPolicy Strict() => new()
    {
        MinLength = 8, RequireUppercase = true, RequireLowercase = true, RequireNumbers = true, RequireSpecialChars = true,
    };

    [Fact]
    public void Every_minted_password_satisfies_the_policy_it_was_minted_for()
    {
        var policies = new[] { new PasswordPolicy(), Strict(), new PasswordPolicy { MinLength = 40 }, new PasswordPolicy { MinLength = 1, RequireUppercase = false, RequireLowercase = false, RequireNumbers = false } };
        foreach (var policy in policies)
        {
            for (var i = 0; i < 200; i++)
            {
                var password = TemporaryPasswords.Generate(policy);
                Assert.Null(PasswordPolicyValidation.Validate(password, policy));
            }
        }
    }

    [Fact]
    public void Length_is_at_least_sixteen_and_honours_a_longer_minimum_up_to_the_bcrypt_ceiling()
    {
        Assert.Equal(16, TemporaryPasswords.Generate(new PasswordPolicy()).Length);
        Assert.Equal(40, TemporaryPasswords.Generate(new PasswordPolicy { MinLength = 40 }).Length);
        Assert.Equal(PasswordPolicyValidation.MaxLength, TemporaryPasswords.Generate(new PasswordPolicy { MinLength = 500 }).Length);
    }

    [Fact]
    public void Two_mints_differ_and_the_mandatory_characters_are_not_always_at_the_front()
    {
        var a = TemporaryPasswords.Generate(Strict());
        var b = TemporaryPasswords.Generate(Strict());
        Assert.NotEqual(a, b);
        // If the shuffle were missing, position 0 would always be a lowercase letter.
        var firstIsAlwaysLower = Enumerable.Range(0, 100).All(_ => char.IsLower(TemporaryPasswords.Generate(Strict())[0]));
        Assert.False(firstIsAlwaysLower);
    }

    [Fact]
    public void Avoids_the_characters_that_misread_on_a_printout()
    {
        for (var i = 0; i < 200; i++)
        {
            var password = TemporaryPasswords.Generate(Strict());
            Assert.DoesNotContain(password, c => c is 'I' or 'O' or 'l' or '0' or '1');
        }
    }
}
