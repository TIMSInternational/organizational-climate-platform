using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ReportShareConfiguration : IEntityTypeConfiguration<ReportShare>
{
    public void Configure(EntityTypeBuilder<ReportShare> builder)
    {
        builder.ToTable("report_shares");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.ReportId).HasColumnName("report_id").IsRequired();

        // 64 hex characters, exactly. Fixed width because SHA-256 has one.
        builder.Property(s => s.TokenHash).HasColumnName("token_hash").HasMaxLength(64).IsRequired();

        builder.Property(s => s.CreatedBy).HasColumnName("created_by");
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.ExpiresAt).HasColumnName("expires_at").IsRequired();
        builder.Property(s => s.RevokedAt).HasColumnName("revoked_at");
        builder.Property(s => s.RevokedBy).HasColumnName("revoked_by");
        builder.Property(s => s.AccessCount).HasColumnName("access_count").IsRequired().HasDefaultValue(0);
        builder.Property(s => s.LastAccessedAt).HasColumnName("last_accessed_at");

        // Unique, and the only index the resolve path uses: every unauthenticated request is a
        // single index probe on this column, whatever the token turns out to be. That is a
        // correctness property as much as a performance one -- a resolve that scanned would
        // take a length of time that varies with what it found, and the acceptance criterion
        // is that a caller cannot tell the cases apart.
        builder.HasIndex(s => s.TokenHash).IsUnique();

        // Listing a report's links, newest first.
        builder.HasIndex(s => new { s.ReportId, s.CreatedAt });

        // Cascade: a share link is meaningless without the report it opens, and leaving rows
        // behind would leave live tokens pointing at nothing. This is the deliberate exception
        // to the house preference for RESTRICT -- the child has no independent existence.
        builder.HasOne<Report>().WithMany().HasForeignKey(s => s.ReportId).OnDelete(DeleteBehavior.Cascade);

        // SetNull rather than Restrict: deleting an administrator's account must not be blocked
        // by, nor silently destroy, a link that is still live for its holders. The link outlives
        // the person; the attribution does not.
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.CreatedBy).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.RevokedBy).OnDelete(DeleteBehavior.SetNull);
    }
}
