using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyAuditLogConfiguration : IEntityTypeConfiguration<SurveyAuditLog>
{
    public void Configure(EntityTypeBuilder<SurveyAuditLog> builder)
    {
        builder.ToTable("survey_audit_logs");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(a => a.Action).HasColumnName("action").HasMaxLength(30).IsRequired();
        builder.Property(a => a.EntityType).HasColumnName("entity_type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.EntityId).HasColumnName("entity_id").HasMaxLength(100);
        builder.Property(a => a.Changes).HasColumnName("changes").HasColumnType("jsonb");
        builder.Property(a => a.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(a => a.UserName).HasColumnName("user_name").HasMaxLength(200).IsRequired();
        builder.Property(a => a.UserEmail).HasColumnName("user_email").HasMaxLength(255).IsRequired();
        builder.Property(a => a.UserRole).HasColumnName("user_role").HasMaxLength(32).IsRequired();
        builder.Property(a => a.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property(a => a.IpAddress).HasColumnName("ip_address").HasMaxLength(64);
        builder.Property(a => a.UserAgent).HasColumnName("user_agent").HasMaxLength(500);
        builder.Property(a => a.SessionId).HasColumnName("session_id").HasMaxLength(200);
        builder.Property(a => a.Metadata).HasColumnName("metadata").HasColumnType("jsonb");

        builder.HasIndex(a => new { a.SurveyId, a.Timestamp });

        builder.HasOne<Survey>().WithMany().HasForeignKey(a => a.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
