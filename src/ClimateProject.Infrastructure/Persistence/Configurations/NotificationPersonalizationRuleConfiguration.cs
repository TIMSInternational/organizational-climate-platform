using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationPersonalizationRuleConfiguration : IEntityTypeConfiguration<NotificationPersonalizationRule>
{
    public void Configure(EntityTypeBuilder<NotificationPersonalizationRule> builder)
    {
        builder.ToTable("notification_personalization_rules");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.NotificationTemplateId).HasColumnName("notification_template_id").IsRequired();
        builder.Property(r => r.Condition).HasColumnName("condition").HasColumnType("text").IsRequired();
        builder.Property(r => r.Modifications).HasColumnName("modifications").HasColumnType("jsonb");

        builder.HasOne<NotificationTemplate>().WithMany().HasForeignKey(r => r.NotificationTemplateId);
    }
}
