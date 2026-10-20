using System.Security.Claims;
using System.Text.RegularExpressions;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class AuthEndpoints
{
    // Same simple pattern used by the legacy climate-project codebase for
    // signup email-format validation.
    private const string EmailFormatPattern = @"^[^\s@]+@[^\s@]+\.[^\s@]+$";

    // Registration is invitation-only: an account can only be created for a domain some
    // company already owns. One constant, shared by /auth/signup and /auth/google, because
    // the two paths used to disagree -- signup refused an unknown domain while Google
    // silently provisioned a brand-new tenant for it, gmail.com included (#280).
    // Said plainly, and only ever to a caller who already holds a valid token for the
    // account: reaching the ceiling is not a credential failure and there is nothing the
    // holder can do about it but sign in again.
    private const string SessionCeilingReachedMessage =
        "This session has reached its maximum length. Please sign in again.";

    private const string NoCompanyForDomainMessage =
        "No company found for this email domain. Please contact your administrator for an invitation.";

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/auth");

        // The three unauthenticated routes carry the strictest policy in the app (#146):
        // this is the surface where credential stuffing is the realistic attack, and where a
        // caller making twenty attempts a minute is already not a person. /refresh and
        // /admin/reset-credentials below need a valid token first and are covered by the
        // per-user global ceiling instead.
        group.MapPost("/login", LoginAsync).RequireRateLimiting(RateLimitPolicies.Authentication);
        group.MapPost("/signup", SignupAsync).RequireRateLimiting(RateLimitPolicies.Authentication);
        group.MapPost("/google", GoogleLoginAsync).RequireRateLimiting(RateLimitPolicies.Authentication);
        group.MapPost("/refresh", RefreshAsync).RequireAuthorization();
        group.MapPost("/admin/reset-credentials", ResetCredentialsAsync).RequireAuthorization();
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.Json(new ErrorResponse("Email and password are required"), statusCode: 400);
        }

        // The one field takes an email or a mass invite's generated username (ruled 2026-10-13).
        // An '@' decides which: a username is drawn from an alphabet that has none, and every
        // email has one, so the two lookups can never both match.
        var identifier = request.Email.Trim().ToLowerInvariant();
        var user = identifier.Contains('@', StringComparison.Ordinal)
            ? await db.Users.FirstOrDefaultAsync(u => u.Email == identifier && u.IsActive, cancellationToken)
            : await db.Users.FirstOrDefaultAsync(u => u.Username == identifier && u.IsActive, cancellationToken);

        // A PER-SURVEY credential, when the account namespace did not answer. Only for a
        // username: `survey_credentials.username` is minted by the same generator as
        // `users.username`, from an alphabet with no '@', so an address can never land here.
        //
        // Second, not first, so this cannot change what an existing sign-in does. The two
        // namespaces share one unique index each and are deduped against each other at mint
        // time, so at most one of the two lookups can match -- but the order makes that a
        // property of the code rather than of the data.
        SurveyCredential? credential = null;
        if (user is null && !identifier.Contains('@', StringComparison.Ordinal))
        {
            credential = await db.SurveyCredentials
                .FirstOrDefaultAsync(c => c.Username == identifier, cancellationToken);
            if (credential is not null)
            {
                user = await db.Users.FirstOrDefaultAsync(
                    u => u.Id == credential.UserId && u.IsActive, cancellationToken);
            }
        }

        if (user is null)
        {
            return Results.Json(new ErrorResponse("Invalid email or password"), statusCode: 401);
        }

        // The credential's own hash when one was resolved, never the account's. A per-survey
        // respondent has no password on `users` at all, and falling back to it would let the
        // account password open a survey it was not issued for.
        var hash = credential?.PasswordHash ?? user.PasswordHash;

        if (hash is null)
        {
            return Results.Json(new ErrorResponse("This account uses Google sign-in"), statusCode: 401);
        }

        if (!passwordHasher.Verify(request.Password, hash))
        {
            return Results.Json(new ErrorResponse("Invalid email or password"), statusCode: 401);
        }

        if (credential is not null)
        {
            // Not security state. On an anonymous survey nothing else can tell an
            // administrator that a credential arrived and was used.
            credential.LastSignInAt = DateTimeOffset.UtcNow;
        }

        var gate = await CheckSystemSettingsGateAsync(db, user.Role, cancellationToken, user.Preferences.Language);
        if (gate is not null)
        {
            return gate;
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        // Unreachable in practice -- the query above already filters on IsActive -- but the
        // refusal is passed anyway so the guard inside IssueTokenForAsync has the answer this
        // path is supposed to give: identical to a wrong password, so the endpoint is not an
        // oracle for which addresses exist.
        return await IssueTokenForAsync(
            user, db, jwtTokenService,
            Results.Json(new ErrorResponse("Invalid email or password"), statusCode: 401),
            // A sign-in is where the absolute ceiling starts counting. Every other mint
            // carries this instant forward instead of replacing it.
            sessionStartedAt: DateTimeOffset.UtcNow,
            cancellationToken,
            surveyScope: credential?.SurveyId);
    }

    private static async Task<IResult> SignupAsync(
        SignupRequest request,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.Json(new ErrorResponse("Name, email, and password are required"), statusCode: 400);
        }

        // Signup has no existing user yet to check for a SuperAdmin bypass -- a fresh
        // signup is always minted as Roles.Employee below, so the platform-wide kill
        // switches apply unconditionally here (unlike LoginAsync/GoogleLoginAsync).
        var signupGate = await CheckSystemSettingsGateAsync(db, currentUserRole: null, cancellationToken);
        if (signupGate is not null)
        {
            return signupGate;
        }

        // The whole configured policy, not MinLength alone. Until this change signup read one
        // of the five knobs and ignored the four complexity flags an administrator can switch
        // on at /admin/system-settings -- a setting the product persists and does not honour
        // is worse than an absent one. Same validator, same message shape, as the profile's
        // change-password and invitation acceptance.
        var passwordPolicy = await PasswordPolicies.LoadAsync(db, cancellationToken);
        if (PasswordPolicyValidation.Validate(request.Password, passwordPolicy) is { } passwordError)
        {
            return Results.Json(new ErrorResponse(passwordError), statusCode: 400);
        }

        if (!Regex.IsMatch(request.Email, EmailFormatPattern))
        {
            return Results.Json(new ErrorResponse("Invalid email format"), statusCode: 400);
        }

        var email = request.Email.ToLowerInvariant();

        var existingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        if (existingUser is not null)
        {
            return Results.Json(new ErrorResponse("User with this email already exists"), statusCode: 409);
        }

        var domain = email.Split('@')[1];
        var company = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain, cancellationToken);
        if (company is null)
        {
            return Results.Json(new ErrorResponse(NoCompanyForDomainMessage), statusCode: 404);
        }

        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = email,
            Name = request.Name.Trim(),
            PasswordHash = passwordHasher.Hash(request.Password),
            Role = Roles.Employee,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);

        // A row this method just minted with IsActive = true, so the refusal is unreachable
        // here too; it is supplied for the same reason as in LoginAsync.
        return await IssueTokenForAsync(
            user, db, jwtTokenService,
            Results.Json(new ErrorResponse("Account is no longer active"), statusCode: 401),
            sessionStartedAt: DateTimeOffset.UtcNow,
            cancellationToken,
            successStatusCode: 201);
    }

    private static async Task<IResult> GoogleLoginAsync(
        GoogleLoginRequest request,
        ClimateProjectDbContext db,
        IGoogleTokenVerifier googleTokenVerifier,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdToken))
        {
            return Results.Json(new ErrorResponse("Google ID token is required"), statusCode: 400);
        }

        var googleUser = await googleTokenVerifier.VerifyAsync(request.IdToken, cancellationToken);
        if (googleUser is null)
        {
            return Results.Json(new ErrorResponse("Google sign-in failed"), statusCode: 401);
        }

        var email = googleUser.Email.ToLowerInvariant();
        var domain = email.Split('@')[1];

        // One lookup, done before anything is written: it resolves a SuperAdmin bypass for
        // the kill-switch gate, decides sign-in vs. registration below, and is the row the
        // IsActive guard reads. (It used to be an AsNoTracking read followed by a tracked
        // re-fetch further down; the create-or-update now happens on this instance, and every
        // branch that could return early does so before the first SaveChangesAsync.)
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        var googleGate = await CheckSystemSettingsGateAsync(db, user?.Role, cancellationToken);
        if (googleGate is not null)
        {
            return googleGate;
        }

        // A deactivated account gets exactly the answer an unverifiable ID token gets (#280).
        // Deactivation is how this product removes access, and it used to be enforced on the
        // password and refresh paths only -- a deactivated employee holding a valid Google ID
        // token for their work address was issued a fully working API JWT. The response is the
        // generic one for the same reason LoginAsync answers "Invalid email or password":
        // /auth/google is unauthenticated, so it must not report account state to its caller.
        if (user is not null && !user.IsActive)
        {
            return Results.Json(new ErrorResponse("Google sign-in failed"), statusCode: 401);
        }

        var now = DateTimeOffset.UtcNow;
        if (user is null)
        {
            // Registering, not signing in -- so the invitation-only rule SignupAsync enforces
            // has to hold here too, with the same 404 and the same message. This path
            // used to create a Company for whatever domain it was handed, which made
            // /auth/google a self-service tenant factory for gmail.com and every other
            // consumer domain, contradicting the rule the password path enforces (#280).
            var company = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain, cancellationToken);
            if (company is null)
            {
                return Results.Json(new ErrorResponse(NoCompanyForDomainMessage), statusCode: 404);
            }

            user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = company.Id,
                Email = email,
                Name = googleUser.Name,
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Users.Add(user);
        }

        user.LastLoginAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return await IssueTokenForAsync(
            user, db, jwtTokenService,
            Results.Json(new ErrorResponse("Google sign-in failed"), statusCode: 401),
            sessionStartedAt: now,
            cancellationToken);
    }

    private static async Task<IResult> RefreshAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        // Sub is minted as PersonaExternalId when set, otherwise the user's own Guid Id (see
        // IssueTokenForAsync below, the single mint). It is not always a parseable Guid, so
        // the resolver matches on PersonaExternalId first and only attempts an Id match when
        // the value does parse as one — never let a non-Guid Sub throw here.
        //
        // #285: that rule used to be stated here and not implemented. The code was a single
        // `Id == userId || PersonaExternalId == sub` predicate, which is unordered — under a
        // collision it returned whichever row Postgres reached first, and on this path
        // picking the wrong row mints a token for the wrong user. The order now lives in
        // ActingUserResolver, as two sequential queries, because a WHERE ... OR ... cannot
        // express it.
        var user = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        if (user is null)
        {
            return Results.Json(new ErrorResponse("Account is no longer active"), statusCode: 401);
        }

        // The caller has already proved they hold a token for this account, so unlike the two
        // unauthenticated paths this one may say plainly why the refresh was refused.
        return await IssueTokenForAsync(
            user, db, jwtTokenService,
            Results.Json(new ErrorResponse("Account is no longer active"), statusCode: 401),
            // Carried off the presented token, never restarted. This endpoint is the sliding
            // half of the idle window -- the client calls it on real interaction -- so basing
            // the ceiling on "now" here would mean a session that is used never ends.
            sessionStartedAt: SessionWindows.StartedAt(principal, DateTimeOffset.UtcNow),
            cancellationToken,
            // Carried off the presented token for the same reason the session start is. A
            // re-mint that dropped it would silently WIDEN the session -- a respondent who
            // signed in for one survey would, on their next interaction, be handed a token
            // that sees every survey they are targeted by, halfway through answering.
            surveyScope: currentUser.SurveyScope);
    }

    /// <summary>
    /// The single place this API mints a token, and therefore the single place the
    /// deactivation check can be made unavoidable.
    /// </summary>
    /// <remarks>
    /// The guard lives inside the mint rather than beside each call deliberately (#280).
    /// While it was a per-path convention, three login paths remembered it twice:
    /// /auth/google loaded the user, stamped LastLoginAt and issued a working JWT to
    /// accounts an administrator had deactivated.
    ///
    /// "Single place" is a checkable claim, not a slogan: every caller of
    /// <see cref="IJwtTokenService.IssueToken"/> in this assembly is in this method. The
    /// one that was not — <see cref="InvitationAcceptEndpoints"/>, which hand-rolled its own
    /// <see cref="TokenClaims"/> — now calls through here too, which is why this is
    /// <c>internal</c> rather than <c>private</c>. Keep it that way: a new auth path that
    /// builds its own TokenClaims re-opens exactly the hole #280 was filed for.
    ///
    /// Callers still reject an inactive account themselves where ordering matters — the
    /// point of refusal has to come before any write, and this helper runs after them.
    /// <paramref name="inactiveResponse"/> is each path's own answer, because how much a
    /// refusal may reveal differs: the unauthenticated paths must be indistinguishable from
    /// a failed credential, /auth/refresh may be explicit.
    /// </remarks>
    internal static async Task<IResult> IssueTokenForAsync(
        User user,
        ClimateProjectDbContext db,
        IJwtTokenService jwtTokenService,
        IResult inactiveResponse,
        DateTimeOffset sessionStartedAt,
        CancellationToken cancellationToken,
        int successStatusCode = 200,
        Guid? surveyScope = null)
    {
        if (!user.IsActive)
        {
            return inactiveResponse;
        }

        // The idle window, read here because this is the single mint: every path that hands
        // out a token gets the configured timeout without having to remember it, which is the
        // same argument the deactivation guard above is placed here for. Before this,
        // SessionTimeoutMinutes was a control a super admin could edit that enforced nothing.
        var window = SessionWindows.Next(
            sessionStartedAt,
            DateTimeOffset.UtcNow,
            await SessionTimeouts.LoadMinutesAsync(db, cancellationToken));

        if (window is null)
        {
            // The ceiling, which only a re-mint can reach: a fresh sign-in starts the clock,
            // so `sessionStartedAt` is `now` there and the window is always open.
            return Results.Json(new ErrorResponse(SessionCeilingReachedMessage), statusCode: 401);
        }

        var token = jwtTokenService.IssueToken(new TokenClaims(
            // TrackingIdentifiers.ExternalPersonaId, not an inline `PersonaExternalId ?? Id`
            // (#153). /api/internal/personas derives persona_id through that same method, and
            // climate-tracking compares the two against each other: its persona cache is
            // filled from that endpoint while its authorization reads this claim
            // (CurrentUser.PersonaExternalId, matched against a plan's
            // responsable_ejecucion and involucrados). This is the nodoId story of #151 with
            // a different claim, so it gets the same answer -- one derivation, not two copies
            // of the same conditional, which is how nodoId drifted in the first place.
            Sub: TrackingIdentifiers.ExternalPersonaId(user),
            Role: user.Role,
            NodoId: await NodoClaimResolver.ResolveAsync(db, user, cancellationToken),
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId?.ToString() ?? string.Empty,
            IsActive: user.IsActive,
            // Read off the row, never generated here (#284). The claim's only job is to equal
            // users.security_stamp on the read path, so a value invented at mint time would
            // produce a token that is refused by its own first request. A caller that wants
            // the OTHER sessions gone rotates the column and saves before calling this, and
            // the token minted here then carries the new value -- which is what lets a
            // password change hand its own caller a working session back.
            SecurityStamp: user.SecurityStamp,
            // Null on every path but a per-survey sign-in, and null means "every survey you
            // are targeted by" -- the answer a shared account has always given.
            SurveyScope: surveyScope),
            window);

        return Results.Json(new TokenResponse(token), statusCode: successStatusCode);
    }

    private static async Task<IResult> ResetCredentialsAsync(
        ResetCredentialsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        // Scoped to the admin's own company unless they're a super_admin, mirroring
        // the legacy User.canAccessCompany behavior (super_admin can access any
        // company). Returns 404 -- not 403 -- on a tenant mismatch so this endpoint
        // doesn't leak the existence of users in other companies.
        //
        // Compares Guids, not strings. This used to read `u.CompanyId.ToString() ==
        // currentUser.CompanyId`; once User.CompanyId became Guid? (#191) that receiver is
        // Nullable<Guid>, whose ToString() is a DIFFERENT method that EF cannot translate --
        // it would have thrown "could not be translated" at runtime, not compile time.
        // Parsing the claim up front also means a company-less super_admin (claim is
        // string.Empty) yields null here, so the tenant branch matches nothing at all
        // instead of matching every company-less row.
        var actingCompanyId = CompanyScope.OwnCompanyId(currentUser);
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.Id == request.UserId
                && (currentUser.Role == Roles.SuperAdmin
                    || (actingCompanyId != null && u.CompanyId == actingCompanyId)),
            cancellationToken);
        if (user is null)
        {
            return Results.Json(new ErrorResponse("User not found"), statusCode: 404);
        }

        // A password the product itself would accept: the old Guid-derived twelve hex
        // characters failed the default policy (no uppercase) the moment the holder tried to
        // change it, and never met a tenant policy that required a special character.
        var temporaryPassword = TemporaryPasswords.Generate(await PasswordPolicies.LoadAsync(db, cancellationToken));
        user.PasswordHash = passwordHasher.Hash(temporaryPassword);

        // Every session this account has open ends here (#284). An administrator resetting
        // credentials is usually responding to a compromise, and replacing the hash alone
        // only stops a future login: whoever already holds a token for this row keeps it
        // working for up to 24 hours. Rotating the stamp is what makes the reset take effect
        // now, because SecurityStampValidation compares this column against the claim in
        // every presented token.
        //
        // Including the administrator's own, if they pass their own id: this signs them out
        // too, on the next request, and they sign back in with the temporary password the
        // response hands them. That is the honest outcome of "reset my credentials" and it is
        // why the refusal is a 401 rather than something the SPA would sit on.
        user.SecurityStamp = Guid.NewGuid();

        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new ResetCredentialsResponse(user.Email, temporaryPassword));
    }

    // Platform-wide incident-response kill switches (SystemSettings.LoginEnabled /
    // MaintenanceMode). Read-only -- deliberately does NOT call
    // SystemSettingsEndpoints.GetOrCreateAsync, so a login/signup attempt never
    // has the side effect of creating the singleton row; a missing row is treated
    // as "defaults" (LoginEnabled=true, MaintenanceMode=false), i.e. no gating.
    // currentUserRole is null for a brand-new signup (no existing user yet) or an
    // unresolved Google sign-in -- in both cases there is no SuperAdmin to bypass
    // the gate with.
    /// <param name="locale">
    /// The caller's display preference, when one is known. The maintenance message is
    /// authored content (#195), so it is resolved rather than emitted verbatim.
    /// Signup and Google sign-in have no user yet and therefore no preference: they
    /// get the English text, which is exactly what the single-column version always
    /// emitted, rather than a guess.
    /// </param>
    private static async Task<IResult?> CheckSystemSettingsGateAsync(
        ClimateProjectDbContext db,
        string? currentUserRole,
        CancellationToken cancellationToken,
        string? locale = null)
    {
        var settings = await db.SystemSettings.FirstOrDefaultAsync(cancellationToken);
        if (settings is null || currentUserRole == Roles.SuperAdmin)
        {
            return null;
        }

        if (settings.MaintenanceMode)
        {
            return Results.Json(
                new ErrorResponse(LocalizedContent.ResolveText(settings.MaintenanceMessageEn, settings.MaintenanceMessageEs, locale, ContentLanguages.Both) ?? "The system is currently under maintenance. Please try again later."),
                statusCode: 503);
        }

        if (!settings.LoginEnabled)
        {
            return Results.Json(new ErrorResponse("Login is currently disabled by an administrator."), statusCode: 403);
        }

        return null;
    }

}

public sealed record LoginRequest(string Email, string Password);
public sealed record SignupRequest(string Name, string Email, string Password);
public sealed record GoogleLoginRequest(string IdToken);
public sealed record TokenResponse(string Token);
public sealed record ErrorResponse(string Message);
public sealed record ResetCredentialsRequest(Guid UserId);
public sealed record ResetCredentialsResponse(string Email, string TemporaryPassword);
