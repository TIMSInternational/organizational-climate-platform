using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Auth;

/// <summary>
/// The administrator-configured password policy, as enforced by the self-service
/// change-password route (#136).
///
/// Before this, four of the policy's five knobs were stored and read by nothing at all.
/// These tests exist so that turning one on has an observable consequence.
/// </summary>
public class PasswordPolicyValidationTests
{
    /// <summary>Everything off, so each test can turn on exactly the rule it is about.</summary>
    private static PasswordPolicy Permissive() => new()
    {
        MinLength = 1,
        RequireUppercase = false,
        RequireLowercase = false,
        RequireNumbers = false,
        RequireSpecialChars = false,
    };

    [Fact]
    public void The_shipped_defaults_accept_a_normal_strong_password()
        => Assert.Null(PasswordPolicyValidation.Validate("Str0ngEnough", new PasswordPolicy()));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void An_absent_password_is_rejected(string? password)
        => Assert.Equal("Password is required", PasswordPolicyValidation.Validate(password, Permissive()));

    [Fact]
    public void MinLength_is_honoured()
    {
        var policy = Permissive();
        policy.MinLength = 12;

        Assert.Contains("at least 12", PasswordPolicyValidation.Validate("short", policy));
        Assert.Null(PasswordPolicyValidation.Validate("twelvechars!", policy));
    }

    [Fact]
    public void RequireUppercase_is_honoured()
    {
        var policy = Permissive();
        policy.RequireUppercase = true;

        Assert.Contains("uppercase", PasswordPolicyValidation.Validate("all lower", policy));
        Assert.Null(PasswordPolicyValidation.Validate("One Upper", policy));
    }

    [Fact]
    public void RequireLowercase_is_honoured()
    {
        var policy = Permissive();
        policy.RequireLowercase = true;

        Assert.Contains("lowercase", PasswordPolicyValidation.Validate("ALL UPPER", policy));
        Assert.Null(PasswordPolicyValidation.Validate("ONE lower", policy));
    }

    [Fact]
    public void RequireNumbers_is_honoured()
    {
        var policy = Permissive();
        policy.RequireNumbers = true;

        Assert.Contains("number", PasswordPolicyValidation.Validate("no digits here", policy));
        Assert.Null(PasswordPolicyValidation.Validate("one digit 1", policy));
    }

    [Fact]
    public void RequireSpecialChars_is_honoured_and_is_off_by_default()
    {
        Assert.False(new PasswordPolicy().RequireSpecialChars);

        var policy = Permissive();
        policy.RequireSpecialChars = true;

        Assert.Contains("special character", PasswordPolicyValidation.Validate("plain123", policy));
        Assert.Null(PasswordPolicyValidation.Validate("plain123!", policy));
    }

    /// <summary>
    /// A space is not a special character here. Counting one would mean "Correct horse"
    /// satisfies a policy the admin turned on to demand punctuation -- and the rule would be
    /// impossible to state in the UI.
    /// </summary>
    [Fact]
    public void A_space_does_not_count_as_a_special_character()
    {
        var policy = Permissive();
        policy.RequireSpecialChars = true;

        Assert.NotNull(PasswordPolicyValidation.Validate("correct horse battery", policy));
    }

    /// <summary>
    /// bcrypt truncates past 72 bytes, so a longer password is not the password the user
    /// chose and two different ones can hash identically. Rejecting is the only honest
    /// answer.
    /// </summary>
    [Fact]
    public void A_password_longer_than_bcrypt_can_hash_is_rejected()
    {
        var tooLong = new string('a', PasswordPolicyValidation.MaxLength + 1);

        Assert.Contains("at most 72", PasswordPolicyValidation.Validate(tooLong, Permissive()));
        Assert.Null(PasswordPolicyValidation.Validate(new string('a', PasswordPolicyValidation.MaxLength), Permissive()));
    }

    /// <summary>
    /// Every unmet requirement in one message. A form that reveals one at a time turns one
    /// rejected submission into five.
    /// </summary>
    [Fact]
    public void Every_unmet_requirement_is_named_at_once()
    {
        var message = PasswordPolicyValidation.Validate("abc", new PasswordPolicy { MinLength = 8 });

        Assert.NotNull(message);
        Assert.Contains("at least 8", message);
        Assert.Contains("uppercase", message);
        Assert.Contains("number", message);
    }
}
