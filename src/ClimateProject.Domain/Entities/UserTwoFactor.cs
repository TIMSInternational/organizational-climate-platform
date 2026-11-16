namespace ClimateProject.Domain.Entities;

/// <summary>
/// One user's second sign-in factor (TOTP, RFC 6238), at most one row per user.
/// </summary>
/// <remarks>
/// A row of its own rather than columns on <c>users</c>: a reset is "delete the row", so no
/// column a reset must clear can be forgotten. Both secrets are stored AES-GCM encrypted
/// (<c>TotpSecretProtector</c>, key <c>Auth:TotpEncryptionKey</c>) and are never returned after
/// the enrollment start that showed them.
/// </remarks>
public class UserTwoFactor
{
    public Guid UserId { get; set; }

    /// <summary>The active secret, encrypted. Null until an enrollment is confirmed.</summary>
    public byte[]? SecretCiphertext { get; set; }

    /// <summary>A secret shown by an enrollment start and not yet confirmed with a code.</summary>
    public byte[]? PendingSecretCiphertext { get; set; }

    public DateTimeOffset? PendingCreatedAt { get; set; }

    /// <summary>When the active secret was confirmed. Null means two-factor is not enabled.</summary>
    public DateTimeOffset? EnabledAt { get; set; }

    /// <summary>
    /// The RFC 6238 time step of the last code accepted. A code for this step or an earlier one
    /// is refused, so a code read over someone's shoulder cannot be replayed inside its window.
    /// </summary>
    public long? LastUsedStep { get; set; }

    /// <summary>Consecutive wrong codes since the last accepted one.</summary>
    public int FailedAttempts { get; set; }

    /// <summary>Set after too many wrong codes in a row; every code is refused until then.</summary>
    public DateTimeOffset? LockedUntil { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public bool IsEnabled => SecretCiphertext is not null && EnabledAt is not null;
}

/// <summary>One single-use recovery code, stored as a password hash, never in clear.</summary>
public class UserRecoveryCode
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string CodeHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>When the code was spent. A spent code never opens anything again.</summary>
    public DateTimeOffset? UsedAt { get; set; }
}
