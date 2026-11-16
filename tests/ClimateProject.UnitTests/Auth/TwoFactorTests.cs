using System.IdentityModel.Tokens.Jwt;
using System.Text;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Auth.TwoFactor;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Auth;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.UnitTests.Auth;

public class TotpTests
{
    private static readonly byte[] Rfc6238Secret = Encoding.ASCII.GetBytes("12345678901234567890");

    /// RFC 6238 Appendix B, the SHA1 column, at 8 digits exactly as published.
    [Theory]
    [InlineData(59L, "94287082")]
    [InlineData(1111111109L, "07081804")]
    [InlineData(1111111111L, "14050471")]
    [InlineData(1234567890L, "89005924")]
    [InlineData(2000000000L, "69279037")]
    [InlineData(20000000000L, "65353130")]
    public void Matches_the_RFC_6238_SHA1_test_vectors(long unixSeconds, string expected)
    {
        var step = Totp.StepAt(DateTimeOffset.FromUnixTimeSeconds(unixSeconds));

        Assert.Equal(expected, Totp.Compute(Rfc6238Secret, step, digits: 8));
        Assert.Equal(expected[^6..], Totp.Compute(Rfc6238Secret, step));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(1)]
    public void A_code_one_step_either_side_is_accepted(int offset)
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1111111111);
        var code = Totp.Compute(Rfc6238Secret, Totp.StepAt(now) + offset);

        Assert.Equal(Totp.StepAt(now) + offset, Totp.Match(Rfc6238Secret, code, now, lastUsedStep: null));
    }

    [Theory]
    [InlineData(-2)]
    [InlineData(2)]
    [InlineData(10)]
    public void A_code_two_or_more_steps_away_is_refused(int offset)
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1111111111);
        var code = Totp.Compute(Rfc6238Secret, Totp.StepAt(now) + offset);

        Assert.Null(Totp.Match(Rfc6238Secret, code, now, lastUsedStep: null));
    }

    [Fact]
    public void A_code_already_used_in_its_step_is_refused()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1234567890);
        var code = Totp.Compute(Rfc6238Secret, Totp.StepAt(now));
        var accepted = Totp.Match(Rfc6238Secret, code, now, lastUsedStep: null);

        Assert.NotNull(accepted);
        Assert.Null(Totp.Match(Rfc6238Secret, code, now, lastUsedStep: accepted));
        // ...and a code for an EARLIER step than the last accepted one is refused too.
        var earlier = Totp.Compute(Rfc6238Secret, accepted!.Value - 1);
        Assert.Null(Totp.Match(Rfc6238Secret, earlier, now, lastUsedStep: accepted));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("12345")]
    [InlineData("1234567")]
    [InlineData("12a456")]
    public void Malformed_input_never_matches(string? code)
        => Assert.Null(Totp.Match(Rfc6238Secret, code, DateTimeOffset.UtcNow, null));

    [Fact]
    public void The_otpauth_uri_names_the_issuer_and_the_account()
    {
        var uri = Totp.OtpAuthUri("OCC", "user@x.com", "ABC");
        Assert.Equal(
            "otpauth://totp/OCC:user%40x.com?secret=ABC&issuer=OCC&algorithm=SHA1&digits=6&period=30", uri);
    }
}

public class Base32Tests
{
    /// RFC 4648 section 10 vectors, with the padding removed (otpauth URIs carry none).
    [Theory]
    [InlineData("", "")]
    [InlineData("f", "MY")]
    [InlineData("fo", "MZXQ")]
    [InlineData("foo", "MZXW6")]
    [InlineData("foob", "MZXW6YQ")]
    [InlineData("fooba", "MZXW6YTB")]
    [InlineData("foobar", "MZXW6YTBOI")]
    public void Encodes_the_RFC_4648_vectors(string input, string expected)
        => Assert.Equal(expected, Base32.Encode(Encoding.ASCII.GetBytes(input)));

    [Fact]
    public void The_RFC_6238_secret_encodes_to_its_well_known_form()
        => Assert.Equal("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", Base32.Encode(Encoding.ASCII.GetBytes("12345678901234567890")));
}

public class TotpSecretProtectorTests
{
    private static readonly byte[] Key = Enumerable.Range(1, 32).Select(i => (byte)i).ToArray();
    private static readonly Guid User = Guid.Parse("8a1b2c3d-0000-4000-8000-000000000001");

    [Fact]
    public void A_secret_round_trips()
    {
        var secret = Totp.NewSecret();
        var protector = new TotpSecretProtector(Key);

        var stored = protector.Protect(secret, User);

        Assert.Equal(TotpSecretProtector.NonceBytes + secret.Length + TotpSecretProtector.TagBytes, stored.Length);
        Assert.Equal(secret, protector.Unprotect(stored, User));
        // A fresh nonce per encryption: the same secret never encrypts to the same bytes.
        Assert.NotEqual(stored, protector.Protect(secret, User));
    }

    [Theory]
    [InlineData(0)]   // nonce
    [InlineData(15)]  // ciphertext
    [InlineData(-1)]  // tag (last byte)
    public void Any_flipped_byte_is_refused(int index)
    {
        var protector = new TotpSecretProtector(Key);
        var stored = protector.Protect(Totp.NewSecret(), User);
        var at = index < 0 ? stored.Length + index : index;
        stored[at] ^= 0x01;

        Assert.Null(protector.Unprotect(stored, User));
    }

    [Fact]
    public void Another_key_is_refused()
    {
        var stored = new TotpSecretProtector(Key).Protect(Totp.NewSecret(), User);
        var other = Key.Select(b => (byte)(b ^ 0xFF)).ToArray();

        Assert.Null(new TotpSecretProtector(other).Unprotect(stored, User));
    }

    [Fact]
    public void Another_users_row_is_refused()
    {
        var protector = new TotpSecretProtector(Key);
        var stored = protector.Protect(Totp.NewSecret(), User);

        Assert.Null(protector.Unprotect(stored, Guid.NewGuid()));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not base64!")]
    [InlineData("AAAA")] // 3 bytes
    public void A_missing_or_malformed_key_turns_the_feature_off_without_throwing(string? configured)
    {
        var settings = TwoFactorSettings.FromConfiguredKey(configured, out var problem);

        Assert.False(settings.IsEnabled);
        Assert.NotNull(problem);
    }

    [Fact]
    public void A_32_byte_key_turns_the_feature_on()
    {
        var settings = TwoFactorSettings.FromConfiguredKey(Convert.ToBase64String(Key), out var problem);

        Assert.True(settings.IsEnabled);
        Assert.Null(problem);
        Assert.NotEqual(Key, settings.ChallengeSigningKey);
    }
}

public class RecoveryCodesTests
{
    /// Verify compares plain text: these tests are about single use, not about bcrypt.
    private sealed class PlainHasher : IPasswordHasher
    {
        public string Hash(string password) => "plain:" + password;
        public bool Verify(string password, string hash) => hash == "plain:" + password;
    }

    [Fact]
    public void Ten_distinct_codes_from_the_unambiguous_alphabet()
    {
        var codes = RecoveryCodes.Generate();

        Assert.Equal(RecoveryCodes.Count, codes.Distinct().Count());
        Assert.All(codes, code =>
        {
            Assert.Equal(RecoveryCodes.Length, code.Length);
            Assert.All(code, c => Assert.Contains(c, RecoveryCodes.Alphabet));
        });
        Assert.Matches("^[A-Z2-9]{5}-[A-Z2-9]{5}$", RecoveryCodes.Display(codes[0]));
    }

    [Theory]
    [InlineData("abcde-fghjk", "ABCDEFGHJK")]
    [InlineData(" ABCDE FGHJK ", "ABCDEFGHJK")]
    [InlineData("ABCDEFGHJK", "ABCDEFGHJK")]
    [InlineData("123456", null)]       // a TOTP code is never a recovery code
    [InlineData("ABCDE-FGHJO", null)]  // O is not in the alphabet
    [InlineData("ABCDE-FGHJ", null)]
    public void Input_is_case_insensitive_and_ignores_spaces_and_hyphens(string input, string? expected)
        => Assert.Equal(expected, RecoveryCodes.Normalise(input));

    [Fact]
    public void A_code_opens_once_and_never_again()
    {
        var hasher = new PlainHasher();
        var codes = RecoveryCodes.Generate()
            .Select(c => new UserRecoveryCode { Id = Guid.NewGuid(), CodeHash = hasher.Hash(c) })
            .ToList();
        var typed = RecoveryCodes.Display(RecoveryCodes.Generate()[0]);
        codes[3].CodeHash = hasher.Hash(RecoveryCodes.Normalise(typed)!);

        Assert.True(RecoveryCodes.TryConsume(codes, typed.ToLowerInvariant(), hasher, DateTimeOffset.UtcNow));
        Assert.NotNull(codes[3].UsedAt);
        Assert.False(RecoveryCodes.TryConsume(codes, typed, hasher, DateTimeOffset.UtcNow));
        Assert.Equal(9, codes.Count(c => c.UsedAt is null));
    }
}

public class TwoFactorChallengeTokensTests
{
    private static readonly TwoFactorSettings Settings =
        TwoFactorSettings.FromConfiguredKey(Convert.ToBase64String(new byte[32]), out _);

    private static readonly DateTimeOffset Now = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);

    [Fact]
    public async Task A_challenge_reads_back_for_its_own_purpose_only()
    {
        var user = Guid.NewGuid();
        var stamp = Guid.NewGuid();
        var token = TwoFactorChallengeTokens.Create(Settings, user, TwoFactorChallengeTokens.Verify, stamp, null, Now);

        var read = await TwoFactorChallengeTokens.ReadAsync(Settings, token, TwoFactorChallengeTokens.Verify, Now);
        Assert.Equal(new TwoFactorChallenge(user, TwoFactorChallengeTokens.Verify, stamp, null), read);
        Assert.Null(await TwoFactorChallengeTokens.ReadAsync(Settings, token, TwoFactorChallengeTokens.Enroll, Now));
    }

    [Fact]
    public async Task A_challenge_expires_after_five_minutes()
    {
        var token = TwoFactorChallengeTokens.Create(Settings, Guid.NewGuid(), TwoFactorChallengeTokens.Enroll, Guid.NewGuid(), null, Now);

        Assert.NotNull(await TwoFactorChallengeTokens.ReadAsync(Settings, token, TwoFactorChallengeTokens.Enroll, Now.AddMinutes(4)));
        Assert.Null(await TwoFactorChallengeTokens.ReadAsync(Settings, token, TwoFactorChallengeTokens.Enroll, Now.AddMinutes(5)));
    }

    /// The property that keeps a challenge from ever being a session: it is not signed with the
    /// session secret, so the session scheme's signature check refuses it.
    [Fact]
    public void A_challenge_does_not_validate_under_the_session_signing_secret()
    {
        const string sessionSecret = "integration-test-tracking-jwt-secret-32-bytes-min";
        var token = TwoFactorChallengeTokens.Create(Settings, Guid.NewGuid(), TwoFactorChallengeTokens.Verify, Guid.NewGuid(), null, DateTimeOffset.UtcNow);

        Assert.ThrowsAny<SecurityTokenException>(() => new JwtSecurityTokenHandler().ValidateToken(token, new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(sessionSecret)),
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = false,
        }, out _));
    }

    [Fact]
    public async Task A_token_signed_with_another_key_is_not_a_challenge()
    {
        var other = TwoFactorSettings.FromConfiguredKey(Convert.ToBase64String(Enumerable.Repeat((byte)7, 32).ToArray()), out _);
        var token = TwoFactorChallengeTokens.Create(other, Guid.NewGuid(), TwoFactorChallengeTokens.Verify, Guid.NewGuid(), null, Now);

        Assert.Null(await TwoFactorChallengeTokens.ReadAsync(Settings, token, TwoFactorChallengeTokens.Verify, Now));
    }
}
