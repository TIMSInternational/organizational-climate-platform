using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyInvitationConfiguration : IEntityTypeConfiguration<SurveyInvitation>
{
    public void Configure(EntityTypeBuilder<SurveyInvitation> builder)
    {
        builder.ToTable("survey_invitations");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(i => i.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(i => i.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(i => i.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        builder.Property(i => i.InvitationToken).HasColumnName("invitation_token").HasMaxLength(255).IsRequired();
        builder.Property(i => i.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("pending");
        builder.Property(i => i.SentAt).HasColumnName("sent_at");
        builder.Property(i => i.OpenedAt).HasColumnName("opened_at");
        builder.Property(i => i.StartedAt).HasColumnName("started_at");
        builder.Property(i => i.CompletedAt).HasColumnName("completed_at");
        builder.Property(i => i.ReminderCount).HasColumnName("reminder_count").IsRequired().HasDefaultValue(0);
        builder.Property(i => i.LastReminderSent).HasColumnName("last_reminder_sent");
        builder.Property(i => i.ExpiresAt).HasColumnName("expires_at").IsRequired();
        builder.Property(i => i.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
        builder.Property(i => i.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(i => i.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(i => i.InvitationToken).IsUnique();
        builder.HasIndex(i => new { i.SurveyId, i.UserId }).IsUnique();

        builder.HasOne<Survey>().WithMany().HasForeignKey(i => i.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(i => i.CompanyId);
    }
}
