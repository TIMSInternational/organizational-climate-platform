using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");
        builder.HasKey(u => u.Id);
        // Nullable: NULL means "no tenant / global scope" -- see User.CompanyId (#191).
        builder.Property(u => u.CompanyId).HasColumnName("company_id");
        builder.Property(u => u.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        builder.Property(u => u.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(u => u.PasswordHash).HasColumnName("password_hash");
        builder.Property(u => u.Role).HasColumnName("role").HasMaxLength(32).IsRequired();
        builder.Property(u => u.PersonaExternalId).HasColumnName("persona_external_id").HasMaxLength(64);
        builder.Property(u => u.DepartmentId).HasColumnName("department_id");
        builder.Property(u => u.ManagerId).HasColumnName("manager_id");
        builder.Property(u => u.IsActive).HasColumnName("is_active").IsRequired();

        // No HasDefaultValueSql, deliberately (#284). User.SecurityStamp initialises itself
        // to a fresh Guid, so the application always sends a value and a database-side
        // default would never be reached by anything this code inserts. The backfill of the
        // rows that predate the column is done once, inside the migration.
        builder.Property(u => u.SecurityStamp).HasColumnName("security_stamp").IsRequired();

        builder.Property(u => u.LastLoginAt).HasColumnName("last_login_at");
        builder.Property(u => u.ConsentUpdatedAt).HasColumnName("consent_updated_at");
        builder.Property(u => u.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(u => u.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.HasIndex(u => u.Email).IsUnique();

        // /auth/refresh resolves the acting user by PersonaExternalId (falling back to Id
        // only when the JWT `sub` doesn't parse as a Guid) and trusts that value as a unique
        // identity key. Without a DB-level constraint, a duplicate PersonaExternalId (e.g.
        // from the #56 legacy backfill) would let refresh silently issue a token for
        // whichever row Postgres happens to return first. Filtered so multiple NULLs
        // (every user until that backfill runs) remain allowed, matching the
        // Company.EmailDomain precedent.
        builder.HasIndex(u => u.PersonaExternalId).IsUnique().HasFilter("persona_external_id IS NOT NULL");

        // OnDelete is now PINNED rather than left to EF's default, because the default
        // FLIPS when an FK becomes optional: a required FK defaults to Cascade, an optional
        // one to ClientSetNull (NO ACTION at the DB). Cascade is the established behavior
        // -- ActionPlanTests.Deleting_company_cascades_delete_of_its_action_plans documents
        // it explicitly -- and silently downgrading it would turn "delete a company" into an
        // FK-violation error the moment the company has users. SetNull would be actively
        // worse: deleting a company would PROMOTE every one of its users, company_admins
        // included, to global scope, which is a tenant-isolation hole. A company-less
        // super_admin has no company row to be deleted, so Cascade never reaches them.
        builder.HasOne<Company>().WithMany().HasForeignKey(u => u.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Department>().WithMany().HasForeignKey(u => u.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(u => u.ManagerId).OnDelete(DeleteBehavior.Restrict);

        builder.OwnsOne(u => u.Preferences, preferences =>
        {
            preferences.Property(p => p.Language).HasColumnName("preferences_language").HasMaxLength(10).IsRequired().HasDefaultValue("en");
            preferences.Property(p => p.Timezone).HasColumnName("preferences_timezone").HasMaxLength(100).IsRequired().HasDefaultValue("UTC");
            preferences.Property(p => p.DashboardLayout).HasColumnName("preferences_dashboard_layout").HasMaxLength(50).IsRequired().HasDefaultValue("default");
            preferences.Property(p => p.Theme).HasColumnName("preferences_theme").HasConversion<string>().HasMaxLength(10).IsRequired().HasDefaultValue("light");
        });

        // The six legacy notification_settings preferences (#192). Every default here is
        // lifted verbatim from legacy User.ts NotificationSettingsSchema, and every one is
        // a DB-level HasDefaultValue rather than only a CLR initializer -- a CLR default
        // never reaches a row inserted by the ETL (#154) or by raw SQL, so an opt-out
        // column with no DDL default would come back NOT NULL-violating or, worse, silently
        // "on" for someone who had turned it off.
        //
        // #192's body claims owned types must not use HasDefaultValue and that defaults
        // therefore belong on the CLR property. That is backwards: Preferences and Consent
        // directly above are both OwnsOne and both call HasDefaultValue on every property,
        // in production, today. OwnsOne already flattens into columns on `users`, so
        // "flatten to six columns" and "an owned NotificationPreferences type" emit
        // identical DDL -- the choice was made on readability alone.
        builder.OwnsOne(u => u.Notifications, notifications =>
        {
            notifications.Property(n => n.EmailSurveys).HasColumnName("notifications_email_surveys").IsRequired().HasDefaultValue(true);
            notifications.Property(n => n.EmailMicroclimates).HasColumnName("notifications_email_microclimates").IsRequired().HasDefaultValue(true);
            notifications.Property(n => n.EmailActionPlans).HasColumnName("notifications_email_action_plans").IsRequired().HasDefaultValue(true);
            notifications.Property(n => n.EmailReminders).HasColumnName("notifications_email_reminders").IsRequired().HasDefaultValue(true);
            // Stored for consent fidelity, held off #97's API surface until #82 settles the
            // PWA question -- there is no push infrastructure and no device-token storage in
            // this repo, so the API must not advertise a channel with no delivery path.
            notifications.Property(n => n.PushNotifications).HasColumnName("notifications_push").IsRequired().HasDefaultValue(false);
            notifications.Property(n => n.DigestFrequency).HasColumnName("notifications_digest_frequency").HasConversion<string>().HasMaxLength(20).IsRequired().HasDefaultValue("weekly");
        });

        builder.OwnsOne(u => u.Consent, consent =>
        {
            consent.Property(c => c.Essential).HasColumnName("consent_essential").IsRequired().HasDefaultValue(true);
            consent.Property(c => c.Analytics).HasColumnName("consent_analytics").IsRequired().HasDefaultValue(false);
            consent.Property(c => c.Marketing).HasColumnName("consent_marketing").IsRequired().HasDefaultValue(false);
            consent.Property(c => c.Personalization).HasColumnName("consent_personalization").IsRequired().HasDefaultValue(false);
            consent.Property(c => c.ThirdParty).HasColumnName("consent_third_party").IsRequired().HasDefaultValue(false);
            consent.Property(c => c.Demographics).HasColumnName("consent_demographics").IsRequired().HasDefaultValue(false);
        });
    }
}
