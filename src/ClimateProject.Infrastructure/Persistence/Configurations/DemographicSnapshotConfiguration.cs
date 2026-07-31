using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicSnapshotConfiguration : IEntityTypeConfiguration<DemographicSnapshot>
{
    public void Configure(EntityTypeBuilder<DemographicSnapshot> builder)
    {
        builder.ToTable("demographic_snapshots");
        builder.HasKey(s => s.Id);
        // survey_id is a plain column, not an EF FK -- see AnalyticsInsightConfiguration's comment
        // (Task 3): no Survey entity/table exists yet in this repo.
        builder.Property(s => s.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(s => s.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(s => s.Version).HasColumnName("version").IsRequired();
        builder.Property(s => s.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property(s => s.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(s => s.Reason).HasColumnName("reason").HasMaxLength(500).IsRequired();
        builder.Property(s => s.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.OwnsOne(s => s.Metadata, metadata =>
        {
            metadata.Property(m => m.TotalUsers).HasColumnName("metadata_total_users").IsRequired().HasDefaultValue(0);
            metadata.Property(m => m.DepartmentsCount).HasColumnName("metadata_departments_count").IsRequired().HasDefaultValue(0);
            metadata.Property(m => m.RolesDistribution).HasColumnName("metadata_roles_distribution").HasColumnType("jsonb");
            metadata.Property(m => m.TenureDistribution).HasColumnName("metadata_tenure_distribution").HasColumnType("jsonb");
        });

        builder.HasIndex(s => new { s.SurveyId, s.Version }).IsUnique();
        builder.HasIndex(s => new { s.CompanyId, s.Timestamp });
        builder.HasIndex(s => new { s.SurveyId, s.IsActive });
        builder.HasIndex(s => s.CreatedBy);

        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
