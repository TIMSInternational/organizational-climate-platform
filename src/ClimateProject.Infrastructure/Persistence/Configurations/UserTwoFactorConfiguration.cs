using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class UserTwoFactorConfiguration : IEntityTypeConfiguration<UserTwoFactor>
{
    public void Configure(EntityTypeBuilder<UserTwoFactor> builder)
    {
        builder.ToTable("user_two_factor");
        builder.HasKey(t => t.UserId);
        builder.Property(t => t.UserId).HasColumnName("user_id");
        builder.Property(t => t.SecretCiphertext).HasColumnName("secret_ciphertext");
        builder.Property(t => t.PendingSecretCiphertext).HasColumnName("pending_secret_ciphertext");
        builder.Property(t => t.PendingCreatedAt).HasColumnName("pending_created_at");
        builder.Property(t => t.EnabledAt).HasColumnName("enabled_at");
        builder.Property(t => t.LastUsedStep).HasColumnName("last_used_step");
        builder.Property(t => t.FailedAttempts).HasColumnName("failed_attempts").IsRequired().HasDefaultValue(0);
        builder.Property(t => t.LockedUntil).HasColumnName("locked_until");
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.Ignore(t => t.IsEnabled);

        // Optimistic concurrency on PostgreSQL's xmin (the MicroclimateConfiguration precedent; no
        // column is created). Two requests that read the same row and both accept the same code --
        // a replay raced in parallel -- cannot both save: the second UPDATE matches no row and EF
        // throws DbUpdateConcurrencyException, which the endpoint answers as a wrong code.
        builder.Property<uint>("RowVersion").IsRowVersion();

        // A person's second factor goes with them (company deletion cascades users).
        builder.HasOne<User>().WithOne().HasForeignKey<UserTwoFactor>(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class UserRecoveryCodeConfiguration : IEntityTypeConfiguration<UserRecoveryCode>
{
    public void Configure(EntityTypeBuilder<UserRecoveryCode> builder)
    {
        builder.ToTable("user_recovery_codes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).HasColumnName("id");
        builder.Property(c => c.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(c => c.CodeHash).HasColumnName("code_hash").HasMaxLength(100).IsRequired();
        builder.Property(c => c.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(c => c.UsedAt).HasColumnName("used_at");

        // Same reason as UserTwoFactor's: one recovery code spent by two parallel requests must
        // open only one of them.
        builder.Property<uint>("RowVersion").IsRowVersion();
        builder.HasIndex(c => c.UserId);
        builder.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
