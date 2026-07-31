using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DepartmentConfiguration : IEntityTypeConfiguration<Department>
{
    public void Configure(EntityTypeBuilder<Department> builder)
    {
        builder.ToTable("departments");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(d => d.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(d => d.Description).HasColumnName("description").HasMaxLength(1000);
        builder.Property(d => d.ParentDepartmentId).HasColumnName("parent_department_id");
        builder.Property(d => d.ManagerId).HasColumnName("manager_id");
        builder.Property(d => d.EmployeeCount).HasColumnName("employee_count").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(d => d.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(d => d.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.OwnsOne(d => d.Settings, settings =>
        {
            settings.Property(s => s.SurveyParticipationRequired).HasColumnName("settings_survey_participation_required").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.MicroclimateFrequency).HasColumnName("settings_microclimate_frequency").HasConversion<string>().HasMaxLength(20).IsRequired().HasDefaultValue("monthly");
            settings.Property(s => s.AutoActionPlans).HasColumnName("settings_auto_action_plans").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.NotificationEmail).HasColumnName("settings_notification_email").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.NotificationSlack).HasColumnName("settings_notification_slack").IsRequired().HasDefaultValue(false);
            settings.Property(s => s.NotificationTeams).HasColumnName("settings_notification_teams").IsRequired().HasDefaultValue(false);
        });

        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(d => d.ParentDepartmentId).OnDelete(DeleteBehavior.Restrict);
    }
}
