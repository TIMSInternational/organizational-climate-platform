using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationTemplateVariableConfiguration : IEntityTypeConfiguration<NotificationTemplateVariable>
{
    public void Configure(EntityTypeBuilder<NotificationTemplateVariable> builder)
    {
        builder.ToTable("notification_template_variables");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.NotificationTemplateId).HasColumnName("notification_template_id").IsRequired();
        builder.Property(v => v.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(v => v.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(v => v.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(v => v.Description).HasColumnName("description").HasMaxLength(1000).IsRequired();
        builder.Property(v => v.DefaultValue).HasColumnName("default_value").HasColumnType("jsonb");

        builder.HasOne<NotificationTemplate>().WithMany().HasForeignKey(v => v.NotificationTemplateId);
    }
}
