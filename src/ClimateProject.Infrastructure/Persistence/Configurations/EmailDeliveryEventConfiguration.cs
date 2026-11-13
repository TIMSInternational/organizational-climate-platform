using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class EmailDeliveryEventConfiguration : IEntityTypeConfiguration<EmailDeliveryEvent>
{
    public void Configure(EntityTypeBuilder<EmailDeliveryEvent> builder)
    {
        builder.ToTable("email_delivery_events");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.UserId).HasColumnName("user_id");
        builder.Property(e => e.Email).HasColumnName("email").HasMaxLength(320).IsRequired();
        builder.Property(e => e.EventType).HasColumnName("event_type").HasMaxLength(16).IsRequired();
        builder.Property(e => e.BounceType).HasColumnName("bounce_type").HasMaxLength(32);
        builder.Property(e => e.BounceSubType).HasColumnName("bounce_sub_type").HasMaxLength(64);
        builder.Property(e => e.Diagnostic).HasColumnName("diagnostic").HasMaxLength(500);
        builder.Property(e => e.OccurredAt).HasColumnName("occurred_at").IsRequired();
        builder.Property(e => e.SesMessageId).HasColumnName("ses_message_id").HasMaxLength(128);
        builder.Property(e => e.SnsMessageId).HasColumnName("sns_message_id").HasMaxLength(128).IsRequired();
        builder.Property(e => e.ReceivedAt).HasColumnName("received_at").IsRequired();

        // SNS delivers at least once. The same delivery arriving twice must not count a
        // bounce twice, and this index is what makes the second insert a no-op.
        builder.HasIndex(e => new { e.SnsMessageId, e.Email, e.EventType }).IsUnique();

        // The audit's one question: this person's latest outcome.
        builder.HasIndex(e => new { e.UserId, e.OccurredAt });

        // A deleted person's delivery history goes with them.
        builder.HasOne<User>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
