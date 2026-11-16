using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Auth.TwoFactor;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Two-factor sign-in (ruled 2026-11-15): REQUIRED for super_admin, optional for everyone else who
/// signs in with a password. Why it is required there: a super admin can download every person's
/// answers with name and email (<c>GET /admin/exports/responses</c>), and a password alone was all
/// that stood in front of that.
/// </summary>
/// <remarks>
/// <para>
/// Off entirely when <c>Auth:TotpEncryptionKey</c> is not configured (<see cref="TwoFactorSettings"/>):
/// sign-in is unchanged, nothing is enforced, the profile reports <c>available=false</c> and every
/// route here but <c>GET /profile/two-factor</c> answers 404.
/// </para>
/// <para>
/// Sign-in (<c>/auth/login</c>, <c>/auth/google</c>) goes through <see cref="ChallengeIfRequiredAsync"/>
/// and returns a challenge instead of a token when a second step is due. The challenge is redeemed
/// only at the anonymous routes below, which mint the session through
/// <see cref="AuthEndpoints.IssueTokenForAsync"/> -- the single mint -- like every other path.
/// </para>
/// <para>
/// Enable, disable, reset and re-enroll all rotate <c>users.security_stamp</c>, so every session
/// open at that moment ends (#284). The self-service routes hand the caller a fresh token back.
/// </para>
/// </remarks>
public static class TwoFactorEndpoints
{
    /// <summary>Wrong codes in a row before every code is refused for <see cref="LockDuration"/>.</summary>
    public const int MaxFailedAttempts = 5;

    public static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(15);

    /// <summary>Written instead of the derived action when a sign-in is completed with a recovery code.</summary>
    public const string RecoveryCodeUsedAction = "auth.two-factor.recovery-code.use";

    private const string ExpiredChallengeMessage = "This sign-in has expired. Please sign in again.";
    private const string WrongCodeMessage = "The code is not valid.";
    private const string LockedMessage = "Too many wrong codes. Wait 15 minutes and try again.";

    public static void MapTwoFactorEndpoints(this WebApplication app)
    {
        // Anonymous: the caller holds a challenge, not a session. Same limiter as /auth/login.
        var signIn = app.MapGroup("/auth/two-factor").AddEndpointFilter(RefuseLostRaceAsync);
        signIn.MapPost("/verify", VerifyAsync).RequireRateLimiting(RateLimitPolicies.Authentication);
        signIn.MapPost("/enrollment/start", EnrollmentStartAsync).RequireRateLimiting(RateLimitPolicies.Authentication);
        signIn.MapPost("/enrollment/confirm", EnrollmentConfirmAsync).RequireRateLimiting(RateLimitPolicies.Authentication);

        var profile = app.MapGroup("/profile/two-factor").RequireAuthorization().AddEndpointFilter(RefuseLostRaceAsync);
        profile.MapGet("", GetOwnAsync);
        profile.MapPost("/start", ProfileStartAsync);
        profile.MapPost("/confirm", ProfileConfirmAsync);
        profile.MapPost("/disable", ProfileDisableAsync);

        // Under the existing users group's prefix (/admin/users), not /users.
        var admin = app.MapGroup("/admin/users/{id:guid}/two-factor").RequireAuthorization();
        admin.MapGet("", GetForUserAsync);
        admin.MapPost("/reset", ResetAsync);
    }

    /// <summary>
    /// The loser of a race on the same factor or recovery code. Both rows carry an xmin
    /// concurrency token (UserTwoFactorConfiguration), so when two requests accept the same code
    /// in parallel only the first save lands; the second throws here and is answered exactly as a
    /// wrong code -- the replay refusal, enforced by the database rather than by timing.
    /// </summary>
    internal static async ValueTask<object?> RefuseLostRaceAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        try
        {
            return await next(context);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Unauthorized(WrongCodeMessage);
        }
    }

    // ------------------------------------------------------------------
    // The sign-in gate
    // ------------------------------------------------------------------

    /// <summary>
    /// The challenge a password- or Google-verified sign-in must answer before it gets a session,
    /// or null when none is due (feature off, or no factor and not a super admin).
    /// </summary>
    internal static async Task<IResult?> ChallengeIfRequiredAsync(
        User user,
        Guid? surveyScope,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (!settings.IsEnabled || !user.IsActive)
        {
            return null;
        }

        var enabled = await db.UserTwoFactors.AsNoTracking()
            .AnyAsync(t => t.UserId == user.Id && t.SecretCiphertext != null && t.EnabledAt != null, cancellationToken);

        string purpose;
        if (enabled)
        {
            purpose = TwoFactorChallengeTokens.Verify;
        }
        else if (user.Role == Roles.SuperAdmin)
        {
            purpose = TwoFactorChallengeTokens.Enroll;
        }
        else
        {
            return null;
        }

        var token = TwoFactorChallengeTokens.Create(
            settings, user.Id, purpose, user.SecurityStamp, surveyScope, clock.GetUtcNow());
        return Results.Ok(new TwoFactorChallengeResponse(
            purpose, token, (int)TwoFactorChallengeTokens.Lifetime.TotalSeconds));
    }

    // ------------------------------------------------------------------
    // Second step (anonymous)
    // ------------------------------------------------------------------

    private static async Task<IResult> VerifyAsync(
        TwoFactorVerifyRequest request,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        TimeProvider clock,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        if (!settings.IsEnabled)
        {
            return Results.NotFound();
        }

        var now = clock.GetUtcNow();
        var (user, challenge) = await RedeemAsync(settings, db, request.ChallengeToken, TwoFactorChallengeTokens.Verify, now, cancellationToken);
        if (user is null || challenge is null)
        {
            return Unauthorized(ExpiredChallengeMessage);
        }

        AttributeToOwnCompany(audit, user);

        var factor = await db.UserTwoFactors.FirstOrDefaultAsync(t => t.UserId == user.Id, cancellationToken);
        if (factor is null || !factor.IsEnabled)
        {
            return Unauthorized(ExpiredChallengeMessage);
        }

        var outcome = await CheckCodeAsync(factor, user.Id, request.Code, useActiveSecret: true, settings, db, passwordHasher, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        if (outcome.Refusal is { } refusal)
        {
            return refusal;
        }

        int? remaining = null;
        if (outcome.UsedRecoveryCode)
        {
            audit.Describe(RecoveryCodeUsedAction, resourceId: user.Id.ToString());
            remaining = await db.UserRecoveryCodes.CountAsync(c => c.UserId == user.Id && c.UsedAt == null, cancellationToken);
        }

        user.LastLoginAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return await AuthEndpoints.IssueTokenForAsync(
            user, db, jwtTokenService,
            Unauthorized(ExpiredChallengeMessage),
            // The second step completes the sign-in, so the session ceiling starts here.
            sessionStartedAt: now,
            cancellationToken,
            surveyScope: challenge.SurveyScope,
            responseBody: token => new TwoFactorVerifyResponse(token, remaining));
    }

    private static async Task<IResult> EnrollmentStartAsync(
        TwoFactorChallengeRequest request,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        TimeProvider clock,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        if (!settings.IsEnabled)
        {
            return Results.NotFound();
        }

        var now = clock.GetUtcNow();
        var (user, _) = await RedeemAsync(settings, db, request.ChallengeToken, TwoFactorChallengeTokens.Enroll, now, cancellationToken);
        if (user is null)
        {
            return Unauthorized(ExpiredChallengeMessage);
        }

        AttributeToOwnCompany(audit, user);

        var factor = await LoadOrCreateAsync(db, user.Id, now, cancellationToken);
        if (factor.IsEnabled)
        {
            // An enroll challenge is issued only to an account with no factor; one that gained a
            // factor since must sign in again and answer a verify challenge instead.
            return Unauthorized(ExpiredChallengeMessage);
        }

        return await StartPendingAsync(factor, user, settings, db, now, cancellationToken);
    }

    private static async Task<IResult> EnrollmentConfirmAsync(
        TwoFactorCodeChallengeRequest request,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        TimeProvider clock,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        if (!settings.IsEnabled)
        {
            return Results.NotFound();
        }

        var now = clock.GetUtcNow();
        var (user, challenge) = await RedeemAsync(settings, db, request.ChallengeToken, TwoFactorChallengeTokens.Enroll, now, cancellationToken);
        if (user is null || challenge is null)
        {
            return Unauthorized(ExpiredChallengeMessage);
        }

        AttributeToOwnCompany(audit, user);

        var factor = await db.UserTwoFactors.FirstOrDefaultAsync(t => t.UserId == user.Id, cancellationToken);
        if (factor is null || factor.IsEnabled || factor.PendingSecretCiphertext is null)
        {
            return Unauthorized(ExpiredChallengeMessage);
        }

        var outcome = await CheckCodeAsync(factor, user.Id, request.Code, useActiveSecret: false, settings, db, passwordHasher, now, cancellationToken);
        if (outcome.Refusal is { } refusal)
        {
            await db.SaveChangesAsync(cancellationToken);
            return refusal;
        }

        var codes = await ActivateAsync(factor, user, outcome.MatchedStep!.Value, db, passwordHasher, now, cancellationToken);
        user.LastLoginAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return await AuthEndpoints.IssueTokenForAsync(
            user, db, jwtTokenService,
            Unauthorized(ExpiredChallengeMessage),
            sessionStartedAt: now,
            cancellationToken,
            surveyScope: challenge.SurveyScope,
            responseBody: token => new TwoFactorEnrolledResponse(token, codes));
    }

    // ------------------------------------------------------------------
    // Own profile
    // ------------------------------------------------------------------

    private static async Task<IResult> GetOwnAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        // A per-survey session is a respondent's: it is never offered a second factor.
        var available = settings.IsEnabled && currentUser.SurveyScope is null;
        var factor = await db.UserTwoFactors.AsNoTracking().FirstOrDefaultAsync(t => t.UserId == user.Id, cancellationToken);
        var enabled = factor?.IsEnabled == true;
        var remaining = enabled
            ? await db.UserRecoveryCodes.CountAsync(c => c.UserId == user.Id && c.UsedAt == null, cancellationToken)
            : 0;

        return Results.Ok(new TwoFactorStatusResponse(
            available,
            enabled,
            Required: available && user.Role == Roles.SuperAdmin,
            remaining,
            enabled ? factor!.EnabledAt : null));
    }

    private static async Task<IResult> ProfileStartAsync(
        TwoFactorStartRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        TimeProvider clock,
        IPasswordHasher passwordHasher,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var (user, notAvailable) = await ResolveForProfileAsync(principal, db, settings, cancellationToken);
        if (user is null)
        {
            return notAvailable!;
        }

        AttributeToOwnCompany(audit, user);
        var now = clock.GetUtcNow();
        var factor = await LoadOrCreateAsync(db, user.Id, now, cancellationToken);

        if (factor.IsEnabled)
        {
            // Re-enrolling replaces the factor, so it takes the factor it replaces (or a
            // recovery code, for the person whose phone is gone).
            var outcome = await CheckCodeAsync(factor, user.Id, request.CurrentCode, useActiveSecret: true, settings, db, passwordHasher, now, cancellationToken);
            if (outcome.Refusal is { } refusal)
            {
                await db.SaveChangesAsync(cancellationToken);
                return refusal;
            }
        }

        return await StartPendingAsync(factor, user, settings, db, now, cancellationToken);
    }

    private static async Task<IResult> ProfileConfirmAsync(
        TwoFactorCodeRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        TimeProvider clock,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var (user, notAvailable) = await ResolveForProfileAsync(principal, db, settings, cancellationToken);
        if (user is null)
        {
            return notAvailable!;
        }

        AttributeToOwnCompany(audit, user);
        var now = clock.GetUtcNow();
        var factor = await db.UserTwoFactors.FirstOrDefaultAsync(t => t.UserId == user.Id, cancellationToken);
        if (factor?.PendingSecretCiphertext is null)
        {
            return Results.Json(new ErrorResponse("Start the set-up first."), statusCode: 400);
        }

        var outcome = await CheckCodeAsync(factor, user.Id, request.Code, useActiveSecret: false, settings, db, passwordHasher, now, cancellationToken);
        if (outcome.Refusal is { } refusal)
        {
            await db.SaveChangesAsync(cancellationToken);
            return refusal;
        }

        var codes = await ActivateAsync(factor, user, outcome.MatchedStep!.Value, db, passwordHasher, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        return await AuthEndpoints.IssueTokenForAsync(
            user, db, jwtTokenService,
            Unauthorized("Account is no longer active"),
            // Not a new sign-in: the ceiling carries on from the presented token.
            sessionStartedAt: SessionWindows.StartedAt(principal, now),
            cancellationToken,
            surveyScope: principal.GetCurrentUser().SurveyScope,
            responseBody: token => new TwoFactorEnrolledResponse(token, codes));
    }

    private static async Task<IResult> ProfileDisableAsync(
        TwoFactorCodeRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        TimeProvider clock,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var (user, notAvailable) = await ResolveForProfileAsync(principal, db, settings, cancellationToken);
        if (user is null)
        {
            return notAvailable!;
        }

        AttributeToOwnCompany(audit, user);

        if (user.Role == Roles.SuperAdmin)
        {
            return Results.Json(
                new ErrorResponse("Two-factor sign-in is required for super administrators and cannot be turned off."),
                statusCode: 403);
        }

        var now = clock.GetUtcNow();
        var factor = await db.UserTwoFactors.FirstOrDefaultAsync(t => t.UserId == user.Id, cancellationToken);
        if (factor is null || !factor.IsEnabled)
        {
            return Results.Json(new ErrorResponse("Two-factor sign-in is not on."), statusCode: 400);
        }

        var outcome = await CheckCodeAsync(factor, user.Id, request.Code, useActiveSecret: true, settings, db, passwordHasher, now, cancellationToken);
        if (outcome.Refusal is { } refusal)
        {
            await db.SaveChangesAsync(cancellationToken);
            return refusal;
        }

        await RemoveFactorAsync(db, user, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        return await AuthEndpoints.IssueTokenForAsync(
            user, db, jwtTokenService,
            Unauthorized("Account is no longer active"),
            sessionStartedAt: SessionWindows.StartedAt(principal, now),
            cancellationToken,
            surveyScope: principal.GetCurrentUser().SurveyScope);
    }

    // ------------------------------------------------------------------
    // Administration (super_admin only)
    // ------------------------------------------------------------------

    private static async Task<IResult> GetForUserAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (principal.GetCurrentUser().Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (!await db.Users.AnyAsync(u => u.Id == id, cancellationToken))
        {
            return Results.NotFound();
        }

        var factor = await db.UserTwoFactors.AsNoTracking().FirstOrDefaultAsync(t => t.UserId == id, cancellationToken);
        var enabled = factor?.IsEnabled == true;
        return Results.Ok(new TwoFactorAdminStatusResponse(enabled, enabled ? factor!.EnabledAt : null));
    }

    private static async Task<IResult> ResetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        TimeProvider clock,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var actor = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        var target = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);

        // Filed under the TARGET's company: a TIMS operator may carry no company of their own,
        // and the middleware writes no row it cannot attribute (the SurveyCredentialEndpoints
        // precedent). Attributed before the role check, so a refused attempt is on the trail too.
        if (actor is not null && (target?.CompanyId ?? actor.CompanyId) is { } companyId)
        {
            audit.AttributeTo(actor.Id, companyId);
        }

        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (target is null)
        {
            return Results.NotFound();
        }

        var had = await db.UserTwoFactors.AnyAsync(t => t.UserId == id && t.EnabledAt != null, cancellationToken);
        audit.RecordChange("twoFactor", had ? "enabled" : "off", "off");

        await RemoveFactorAsync(db, target, clock.GetUtcNow(), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    // ------------------------------------------------------------------
    // Shared steps
    // ------------------------------------------------------------------

    private static IResult Unauthorized(string message) => Results.Json(new ErrorResponse(message), statusCode: 401);

    /// <summary>
    /// The user a challenge names, when the challenge is valid for <paramref name="purpose"/>,
    /// unexpired, and still bound to the row's current security stamp.
    /// </summary>
    private static async Task<(User? User, TwoFactorChallenge? Challenge)> RedeemAsync(
        TwoFactorSettings settings,
        ClimateProjectDbContext db,
        string? token,
        string purpose,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var challenge = await TwoFactorChallengeTokens.ReadAsync(settings, token, purpose, now);
        if (challenge is null)
        {
            return (null, null);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == challenge.UserId && u.IsActive, cancellationToken);
        if (user is null || user.SecurityStamp != challenge.SecurityStamp)
        {
            return (null, null);
        }

        return (user, challenge);
    }

    private static async Task<(User? User, IResult? Refusal)> ResolveForProfileAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        TwoFactorSettings settings,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!settings.IsEnabled || currentUser.SurveyScope is not null)
        {
            return (null, Results.NotFound());
        }

        var user = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        return user is null ? (null, Results.Forbid()) : (user, null);
    }

    private static void AttributeToOwnCompany(AuditEntry audit, User user)
    {
        // A company-less super admin cannot be filed anywhere (audit_logs.company_id is NOT
        // NULL); TIMS operators are homed in a company, so theirs are.
        if (user.CompanyId is { } companyId)
        {
            audit.AttributeTo(user.Id, companyId);
        }
    }

    private static async Task<UserTwoFactor> LoadOrCreateAsync(
        ClimateProjectDbContext db, Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var factor = await db.UserTwoFactors.FirstOrDefaultAsync(t => t.UserId == userId, cancellationToken);
        if (factor is null)
        {
            factor = new UserTwoFactor { UserId = userId, UpdatedAt = now };
            db.UserTwoFactors.Add(factor);
        }

        return factor;
    }

    private static async Task<IResult> StartPendingAsync(
        UserTwoFactor factor,
        User user,
        TwoFactorSettings settings,
        ClimateProjectDbContext db,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var secret = Totp.NewSecret();
        factor.PendingSecretCiphertext = settings.Protector!.Protect(secret, user.Id);
        factor.PendingCreatedAt = now;
        factor.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        var base32 = Base32.Encode(secret);
        return Results.Ok(new TwoFactorSecretResponse(
            base32, Totp.OtpAuthUri(TwoFactorSettings.Issuer, user.Email, base32)));
    }

    private sealed record CodeOutcome(long? MatchedStep, bool UsedRecoveryCode, IResult? Refusal);

    /// <summary>
    /// Checks a code against the active secret (or the pending one, while confirming), or -- on
    /// the active secret only -- against an unspent recovery code. Counts failures and locks.
    /// The caller saves.
    /// </summary>
    private static async Task<CodeOutcome> CheckCodeAsync(
        UserTwoFactor factor,
        Guid userId,
        string? code,
        bool useActiveSecret,
        TwoFactorSettings settings,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (factor.LockedUntil is { } lockedUntil && lockedUntil > now)
        {
            return new CodeOutcome(null, false, Unauthorized(LockedMessage));
        }

        var trimmed = code?.Trim().Replace(" ", string.Empty, StringComparison.Ordinal);
        long? step = null;
        var usedRecovery = false;

        if (Totp.IsWellFormedCode(trimmed))
        {
            var secret = settings.Protector!.Unprotect(
                useActiveSecret ? factor.SecretCiphertext : factor.PendingSecretCiphertext, userId);

            // A pending secret has never produced an accepted code, so it has no replay floor.
            step = secret is null ? null : Totp.Match(secret, trimmed, now, useActiveSecret ? factor.LastUsedStep : null);
        }
        else if (useActiveSecret && RecoveryCodes.Normalise(trimmed) is not null)
        {
            var unspent = await db.UserRecoveryCodes
                .Where(c => c.UserId == userId && c.UsedAt == null)
                .ToListAsync(cancellationToken);
            usedRecovery = RecoveryCodes.TryConsume(unspent, trimmed, passwordHasher, now);
        }

        factor.UpdatedAt = now;
        if (step is null && !usedRecovery)
        {
            factor.FailedAttempts++;
            if (factor.FailedAttempts >= MaxFailedAttempts)
            {
                factor.LockedUntil = now.Add(LockDuration);
                factor.FailedAttempts = 0;
            }

            return new CodeOutcome(null, false, Unauthorized(WrongCodeMessage));
        }

        factor.FailedAttempts = 0;
        factor.LockedUntil = null;
        if (step is { } accepted && useActiveSecret)
        {
            factor.LastUsedStep = accepted;
        }

        return new CodeOutcome(step, usedRecovery, null);
    }

    /// <summary>
    /// Makes the pending secret the active one, replaces the recovery codes, and rotates the
    /// security stamp so every session open before this moment ends. Returns the codes to show.
    /// </summary>
    private static async Task<IReadOnlyList<string>> ActivateAsync(
        UserTwoFactor factor,
        User user,
        long matchedStep,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        factor.SecretCiphertext = factor.PendingSecretCiphertext;
        factor.PendingSecretCiphertext = null;
        factor.PendingCreatedAt = null;
        factor.EnabledAt = now;
        factor.LastUsedStep = matchedStep;
        factor.UpdatedAt = now;

        // Tracked removals, not ExecuteDelete: the same SaveChanges then writes every change of
        // this request in one transaction, and no tracked row is updated after being deleted.
        db.UserRecoveryCodes.RemoveRange(await db.UserRecoveryCodes.Where(c => c.UserId == user.Id).ToListAsync(cancellationToken));
        var codes = RecoveryCodes.Generate();
        foreach (var code in codes)
        {
            db.UserRecoveryCodes.Add(new UserRecoveryCode
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                CodeHash = passwordHasher.Hash(code),
                CreatedAt = now,
            });
        }

        user.SecurityStamp = Guid.NewGuid();
        user.UpdatedAt = now;
        return codes.Select(RecoveryCodes.Display).ToList();
    }

    /// <summary>Removes the factor and its codes and rotates the stamp. The caller saves.</summary>
    private static async Task RemoveFactorAsync(
        ClimateProjectDbContext db, User user, DateTimeOffset now, CancellationToken cancellationToken)
    {
        db.UserRecoveryCodes.RemoveRange(await db.UserRecoveryCodes.Where(c => c.UserId == user.Id).ToListAsync(cancellationToken));
        if (await db.UserTwoFactors.FirstOrDefaultAsync(t => t.UserId == user.Id, cancellationToken) is { } factor)
        {
            db.UserTwoFactors.Remove(factor);
        }

        user.SecurityStamp = Guid.NewGuid();
        user.UpdatedAt = now;
    }
}

public sealed record TwoFactorChallengeResponse(string TwoFactor, string ChallengeToken, int ExpiresInSeconds);
public sealed record TwoFactorChallengeRequest(string? ChallengeToken);
public sealed record TwoFactorVerifyRequest(string? ChallengeToken, string? Code);
public sealed record TwoFactorCodeChallengeRequest(string? ChallengeToken, string? Code);
public sealed record TwoFactorVerifyResponse(string Token, int? RecoveryCodesRemaining);
public sealed record TwoFactorSecretResponse(string Secret, string OtpauthUri);
public sealed record TwoFactorEnrolledResponse(string Token, IReadOnlyList<string> RecoveryCodes);
public sealed record TwoFactorStatusResponse(bool Available, bool Enabled, bool Required, int RecoveryCodesRemaining, DateTimeOffset? EnabledAt);
public sealed record TwoFactorStartRequest(string? CurrentCode);
public sealed record TwoFactorCodeRequest(string? Code);
public sealed record TwoFactorAdminStatusResponse(bool Enabled, DateTimeOffset? EnabledAt);
