using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ResponseConfiguration : IEntityTypeConfiguration<Response>
{
    public void Configure(EntityTypeBuilder<Response> builder)
    {
        builder.ToTable("responses");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(r => r.UserId).HasColumnName("user_id");
        builder.Property(r => r.SessionId).HasColumnName("session_id").HasMaxLength(200).IsRequired();
        builder.Property(r => r.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(r => r.DepartmentId).HasColumnName("department_id");
        builder.Property(r => r.Language).HasColumnName("language").HasMaxLength(10).IsRequired().HasDefaultValue("en");
        builder.Property(r => r.IsComplete).HasColumnName("is_complete").IsRequired().HasDefaultValue(false);
        builder.Property(r => r.IsAnonymous).HasColumnName("is_anonymous").IsRequired().HasDefaultValue(false);
        builder.Property(r => r.StartTime).HasColumnName("start_time").IsRequired();
        builder.Property(r => r.CompletionTime).HasColumnName("completion_time");
        builder.Property(r => r.TotalTimeSeconds).HasColumnName("total_time_seconds");
        builder.Property(r => r.IpAddress).HasColumnName("ip_address").HasMaxLength(64);
        builder.Property(r => r.UserAgent).HasColumnName("user_agent").HasMaxLength(500);
        builder.Property(r => r.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(r => r.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasOne<Survey>().WithMany().HasForeignKey(r => r.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(r => r.DepartmentId).OnDelete(DeleteBehavior.SetNull);
    }
}
