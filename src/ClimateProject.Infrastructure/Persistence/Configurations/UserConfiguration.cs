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
        builder.Property(u => u.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(u => u.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        builder.Property(u => u.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(u => u.PasswordHash).HasColumnName("password_hash");
        builder.Property(u => u.Role).HasColumnName("role").HasMaxLength(32).IsRequired();
        builder.Property(u => u.NodoId).HasColumnName("nodo_id").HasMaxLength(64);
        builder.Property(u => u.PersonaExternalId).HasColumnName("persona_external_id").HasMaxLength(64);
        builder.Property(u => u.DepartmentId).HasColumnName("department_id");
        builder.Property(u => u.ManagerId).HasColumnName("manager_id");
        builder.Property(u => u.IsActive).HasColumnName("is_active").IsRequired();
        builder.Property(u => u.LastLoginAt).HasColumnName("last_login_at");
        builder.Property(u => u.ConsentUpdatedAt).HasColumnName("consent_updated_at");
        builder.Property(u => u.Demographics).HasColumnName("demographics").HasColumnType("jsonb");
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

        builder.HasOne<Company>().WithMany().HasForeignKey(u => u.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(u => u.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(u => u.ManagerId).OnDelete(DeleteBehavior.Restrict);

        builder.OwnsOne(u => u.Preferences, preferences =>
        {
            preferences.Property(p => p.Language).HasColumnName("preferences_language").HasMaxLength(10).IsRequired().HasDefaultValue("en");
            preferences.Property(p => p.Timezone).HasColumnName("preferences_timezone").HasMaxLength(100).IsRequired().HasDefaultValue("UTC");
            preferences.Property(p => p.DashboardLayout).HasColumnName("preferences_dashboard_layout").HasMaxLength(50).IsRequired().HasDefaultValue("default");
            preferences.Property(p => p.Theme).HasColumnName("preferences_theme").HasConversion<string>().HasMaxLength(10).IsRequired().HasDefaultValue("light");
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
