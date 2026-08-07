namespace ClimateProject.Domain.Entities;

public class User
{
    public Guid Id { get; set; }

    // NULL means global scope: the user belongs to no tenant. Today that is only ever a
    // super_admin, who by definition operates across every company. A sentinel "system"
    // company was deliberately rejected (#191) -- it would have to be excluded by hand from
    // every company list, user count, benchmark aggregate and tracking sync, and one missed
    // exclusion silently corrupts cross-tenant analytics. NULL-as-global is also already
    // this repo's established meaning for the same idea: Benchmark, SurveyTemplate,
    // ActionPlanTemplate, NotificationTemplate and MicroclimateTemplate all use
    // `CompanyId == null` for globally-visible, SuperAdmin-only-to-write rows.
    public Guid? CompanyId { get; set; }
    public required string Email { get; set; }
    public required string Name { get; set; }
    public string? PasswordHash { get; set; }
    public required string Role { get; set; }

    // There is deliberately no NodoId here. The dropped nodo_id column (#151) was written by
    // nothing and read only to mint the nodoId JWT claim, which was therefore always empty.
    // A user's node is DepartmentId; the tracking-facing nodo_id is DERIVED from it by
    // TrackingIdentifiers, never stored, so it cannot fall out of sync with the department.
    public string? PersonaExternalId { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid? ManagerId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset? LastLoginAt { get; set; }
    public DateTimeOffset? ConsentUpdatedAt { get; set; }
    public UserPreferences Preferences { get; set; } = new();

    // Sits beside Consent deliberately: four of these six are email opt-outs that real
    // users have already exercised, so they are consent state in everything but name.
    // Legacy nested them one level deeper (preferences.notification_settings), but a
    // nested owned type buys nothing here -- OwnsOne flattens to columns either way --
    // and the flat placement keeps the opt-out surface visible next to UserConsent
    // rather than buried inside UI preferences. See UserConfiguration (#192).
    public NotificationPreferences Notifications { get; set; } = new();
    public UserConsent Consent { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class UserPreferences
{
    public string Language { get; set; } = "en";
    public string Timezone { get; set; } = "UTC";
    public string DashboardLayout { get; set; } = "default";
    public string Theme { get; set; } = "light";
}

/// <summary>
/// The six legacy <c>notification_settings</c> preferences, carried across verbatim (#192).
///
/// Defaults match legacy <c>User.ts NotificationSettingsSchema</c> exactly. That is not a
/// stylistic choice: four of these are email opt-outs that live users have already set, and
/// any default that differs from legacy silently re-subscribes everyone who opted out the
/// moment the ETL (#154) lands. The platform models consent explicitly via
/// <see cref="UserConsent"/>, so quietly resetting an opt-out would contradict its own posture.
///
/// Flat properties rather than a nested type, mirroring <c>DepartmentSettings</c>, which
/// flattened the identical nested legacy shape (notification_settings.email/slack/teams)
/// into settings_notification_*.
/// </summary>
public class NotificationPreferences
{
    /// <summary>Survey invitations and survey lifecycle mail.</summary>
    public bool EmailSurveys { get; set; } = true;

    /// <summary>Microclimate invitations and results mail.</summary>
    public bool EmailMicroclimates { get; set; } = true;

    /// <summary>Action-plan assignment and progress mail.</summary>
    public bool EmailActionPlans { get; set; } = true;

    /// <summary>Nudges for anything still outstanding.</summary>
    public bool EmailReminders { get; set; } = true;

    /// <summary>
    /// Stored, but deliberately NOT exposed on #97's self-service preferences API until
    /// #82 decides whether the PWA ships.
    ///
    /// It is stored because it is consent state: dropping the column would discard the
    /// legacy value on import, and re-adding it later would default everyone back to a
    /// value they never chose. It is not exposed because this repo has no push
    /// infrastructure and no device-token storage of any kind -- offering the toggle would
    /// advertise a delivery channel that cannot deliver, and a preference the product
    /// silently ignores is worse than an absent one. Five preferences are exposed, six are
    /// stored; wire this into the API in the same change that ships push delivery.
    /// </summary>
    public bool PushNotifications { get; set; }

    /// <summary>
    /// How often digest mail is batched. A validated string, not a C# enum, matching how
    /// Role, Status and Department.MicroclimateFrequency are already handled here --
    /// see <c>NotificationPreferenceValidation.ValidDigestFrequencies</c> for the vocabulary.
    /// </summary>
    public string DigestFrequency { get; set; } = "weekly";
}

public class UserConsent
{
    public bool Essential { get; set; } = true;
    public bool Analytics { get; set; }
    public bool Marketing { get; set; }
    public bool Personalization { get; set; }
    public bool ThirdParty { get; set; }
    public bool Demographics { get; set; }
}
