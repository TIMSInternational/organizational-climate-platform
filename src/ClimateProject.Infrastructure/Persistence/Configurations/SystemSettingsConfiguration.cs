using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SystemSettingsConfiguration : IEntityTypeConfiguration<SystemSettings>
{
    public void Configure(EntityTypeBuilder<SystemSettings> builder)
    {
        builder.ToTable("system_settings");
        builder.HasKey(s => s.Id);

        // Enforces the "singleton" contract at the DB level, not just in application
        // code: SystemSettingsEndpoints.GetOrCreateAsync is read-then-insert with no
        // lock, so two concurrent first-reads (two admin tabs, a refresh racing a
        // StrictMode double-effect) can both observe "no row" and both try to
        // insert. This shadow column always defaults to `true` on insert (the app
        // never sets it), and the unique index below means only one row can ever
        // have that value -- a second concurrent insert throws DbUpdateException,
        // which GetOrCreateAsync catches and turns into a re-read of the winning
        // row instead of a duplicate row / an unhandled 500.
        builder.Property<bool>("SingletonGuard").HasColumnName("singleton_guard").IsRequired().HasDefaultValue(true).ValueGeneratedOnAdd();
        builder.HasIndex("SingletonGuard").IsUnique();

        builder.Property(s => s.LoginEnabled).HasColumnName("login_enabled").IsRequired().HasDefaultValue(true);
        builder.Property(s => s.MaintenanceMode).HasColumnName("maintenance_mode").IsRequired().HasDefaultValue(false);
        builder.Property(s => s.MaintenanceMessage).HasColumnName("maintenance_message").HasMaxLength(500);
        builder.Property(s => s.MaxLoginAttempts).HasColumnName("max_login_attempts").IsRequired().HasDefaultValue(5);
        builder.Property(s => s.SessionTimeoutMinutes).HasColumnName("session_timeout_minutes").IsRequired().HasDefaultValue(60);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.OwnsOne(s => s.PasswordPolicy, policy =>
        {
            policy.Property(p => p.MinLength).HasColumnName("password_min_length").IsRequired().HasDefaultValue(8);
            policy.Property(p => p.RequireUppercase).HasColumnName("password_require_uppercase").IsRequired().HasDefaultValue(true);
            policy.Property(p => p.RequireLowercase).HasColumnName("password_require_lowercase").IsRequired().HasDefaultValue(true);
            policy.Property(p => p.RequireNumbers).HasColumnName("password_require_numbers").IsRequired().HasDefaultValue(true);
            policy.Property(p => p.RequireSpecialChars).HasColumnName("password_require_special_chars").IsRequired().HasDefaultValue(false);
        });

        builder.OwnsOne(s => s.EmailSettings, email =>
        {
            email.Property(e => e.SmtpEnabled).HasColumnName("email_smtp_enabled").IsRequired().HasDefaultValue(false);
            email.Property(e => e.FromEmail).HasColumnName("email_from_email").HasMaxLength(255);
            email.Property(e => e.SmtpHost).HasColumnName("email_smtp_host").HasMaxLength(255);
            email.Property(e => e.SmtpPort).HasColumnName("email_smtp_port");
        });
    }
}
