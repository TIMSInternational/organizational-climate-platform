using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> builder)
    {
        builder.ToTable("audit_logs");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.UserId).HasColumnName("user_id");
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.Action).HasColumnName("action").HasMaxLength(100).IsRequired();
        builder.Property(a => a.Resource).HasColumnName("resource").HasMaxLength(100).IsRequired();
        builder.Property(a => a.ResourceId).HasColumnName("resource_id").HasMaxLength(255);
        builder.Property(a => a.Details).HasColumnName("details").HasColumnType("jsonb");
        builder.Property(a => a.IpAddress).HasColumnName("ip_address").HasMaxLength(64);
        builder.Property(a => a.UserAgent).HasColumnName("user_agent").HasMaxLength(500);
        builder.Property(a => a.Success).HasColumnName("success").IsRequired();
        builder.Property(a => a.ErrorMessage).HasColumnName("error_message").HasMaxLength(2000);
        builder.Property(a => a.Timestamp).HasColumnName("timestamp").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.Timestamp });
        builder.HasIndex(a => a.UserId);

        // NO foreign keys, to companies or to users (dropped 2026-11-08, migration
        // OperatorRulings). An audit row must outlive what it describes, unchanged:
        //  - company_id was RESTRICT, so a company with any audit row could never be deleted
        //    without deleting its history first -- which the append-only rule forbids;
        //  - user_id was SET NULL, so deleting a person had the DATABASE rewrite every audit row
        //    they appear in, past AuditLogAppendOnlyInterceptor, which only sees SaveChanges.
        // Both ids are kept as written; a reader that joins them must tolerate a row whose
        // company or person no longer exists (the deletion itself is the last row filed there).
    }
}
