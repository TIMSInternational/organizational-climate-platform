using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyDepartmentTargetConfiguration : IEntityTypeConfiguration<SurveyDepartmentTarget>
{
    public void Configure(EntityTypeBuilder<SurveyDepartmentTarget> builder)
    {
        builder.ToTable("survey_department_targets");
        builder.HasKey(t => new { t.SurveyId, t.DepartmentId });
        builder.Property(t => t.SurveyId).HasColumnName("survey_id");
        builder.Property(t => t.DepartmentId).HasColumnName("department_id");

        builder.HasOne<Survey>().WithMany().HasForeignKey(t => t.SurveyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(t => t.DepartmentId);
    }
}
