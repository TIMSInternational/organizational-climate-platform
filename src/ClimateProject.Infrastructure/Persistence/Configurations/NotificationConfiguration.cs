using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("notifications");
        builder.HasKey(n => n.Id);
        builder.Property(n => n.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(n => n.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(n => n.Type).HasColumnName("type").HasMaxLength(32).IsRequired();
        builder.Property(n => n.Channel).HasColumnName("channel").HasMaxLength(20).IsRequired();
        builder.Property(n => n.Priority).HasColumnName("priority").HasMaxLength(20).IsRequired().HasDefaultValue("medium");
        builder.Property(n => n.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("pending");
        builder.Property(n => n.Title).HasColumnName("title").HasMaxLength(500).IsRequired();
        builder.Property(n => n.Message).HasColumnName("message").HasColumnType("text").IsRequired();
        builder.Property(n => n.Data).HasColumnName("data").HasColumnType("jsonb");
        builder.Property(n => n.TemplateId).HasColumnName("template_id");
        builder.Property(n => n.ScheduledFor).HasColumnName("scheduled_for").IsRequired();
        builder.Property(n => n.SentAt).HasColumnName("sent_at");
        builder.Property(n => n.DeliveredAt).HasColumnName("delivered_at");
        builder.Property(n => n.OpenedAt).HasColumnName("opened_at");
        builder.Property(n => n.FailedAt).HasColumnName("failed_at");
        builder.Property(n => n.FailureReason).HasColumnName("failure_reason").HasMaxLength(1000);
        builder.Property(n => n.RetryCount).HasColumnName("retry_count").IsRequired().HasDefaultValue(0);
        builder.Property(n => n.MaxRetries).HasColumnName("max_retries").IsRequired().HasDefaultValue(3);
        builder.Property(n => n.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(n => n.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(n => new { n.UserId, n.CreatedAt });
        builder.HasIndex(n => new { n.CompanyId, n.CreatedAt });
        builder.HasIndex(n => new { n.Status, n.ScheduledFor });
        builder.HasIndex(n => new { n.Type, n.Status });
        builder.HasIndex(n => new { n.Priority, n.ScheduledFor });
        builder.HasIndex(n => new { n.UserId, n.Status, n.CreatedAt });
        builder.HasIndex(n => new { n.CompanyId, n.Status, n.CreatedAt });

        builder.HasOne<User>().WithMany().HasForeignKey(n => n.UserId);
        builder.HasOne<Company>().WithMany().HasForeignKey(n => n.CompanyId);
        builder.HasOne<NotificationTemplate>().WithMany().HasForeignKey(n => n.TemplateId).OnDelete(DeleteBehavior.SetNull);

        builder.OwnsOne(n => n.Metadata, metadata =>
        {
            metadata.Property(m => m.UserAgent).HasColumnName("metadata_user_agent").HasMaxLength(500);
            metadata.Property(m => m.IpAddress).HasColumnName("metadata_ip_address").HasMaxLength(64);
            metadata.Property(m => m.EmailClient).HasColumnName("metadata_email_client").HasMaxLength(200);
            metadata.Property(m => m.DeviceType).HasColumnName("metadata_device_type").HasMaxLength(100);
        });
    }
}
