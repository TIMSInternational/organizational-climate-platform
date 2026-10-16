using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyUserTargetConfiguration : IEntityTypeConfiguration<SurveyUserTarget>
{
    public void Configure(EntityTypeBuilder<SurveyUserTarget> builder)
    {
        builder.ToTable("survey_user_targets");
        builder.HasKey(t => new { t.SurveyId, t.UserId });
        builder.Property(t => t.SurveyId).HasColumnName("survey_id");
        builder.Property(t => t.UserId).HasColumnName("user_id");

        // Cascade from the survey, like survey_department_targets: a target is part of the
        // survey, not a record of its own. The user side is RESTRICT by the same reasoning
        // every other user reference uses -- a targeted person is not deletable out from
        // under a live audience without the deletion being noticed.
        builder.HasOne<Survey>().WithMany().HasForeignKey(t => t.SurveyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
