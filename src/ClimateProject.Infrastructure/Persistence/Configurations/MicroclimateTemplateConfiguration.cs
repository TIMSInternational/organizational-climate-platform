using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateTemplateConfiguration : IEntityTypeConfiguration<MicroclimateTemplate>
{
    public void Configure(EntityTypeBuilder<MicroclimateTemplate> builder)
    {
        builder.ToTable("microclimate_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
        builder.Property(t => t.Description).HasColumnName("description").HasMaxLength(500).IsRequired();
        builder.Property(t => t.Category).HasColumnName("category").HasMaxLength(30).IsRequired();
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.CreatedBy).HasColumnName("created_by");
        builder.Property(t => t.IsSystemTemplate).HasColumnName("is_system_template").IsRequired().HasDefaultValue(false);
        builder.Property(t => t.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(t => t.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(t => t.Tags).HasColumnName("tags").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(t => new { t.CompanyId, t.IsActive });
        builder.HasIndex(t => new { t.Category, t.IsActive });

        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy).OnDelete(DeleteBehavior.SetNull);

        builder.OwnsOne(t => t.Settings, settings =>
        {
            settings.Property(s => s.DefaultDurationMinutes).HasColumnName("settings_default_duration_minutes").IsRequired().HasDefaultValue(30);
            settings.Property(s => s.SuggestedFrequency).HasColumnName("settings_suggested_frequency").HasMaxLength(20).IsRequired().HasDefaultValue("weekly");
            settings.Property(s => s.MaxParticipants).HasColumnName("settings_max_participants");
            settings.Property(s => s.AnonymousByDefault).HasColumnName("settings_anonymous_by_default").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.AutoClose).HasColumnName("settings_auto_close").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.ShowLiveResults).HasColumnName("settings_show_live_results").IsRequired().HasDefaultValue(true);
        });
    }
}
