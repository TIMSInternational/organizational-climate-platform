using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class UserInvitationConfiguration : IEntityTypeConfiguration<UserInvitation>
{
    public void Configure(EntityTypeBuilder<UserInvitation> builder)
    {
        builder.ToTable("user_invitations");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.Email).HasColumnName("email").HasMaxLength(255);
        builder.Property(i => i.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(i => i.DepartmentId).HasColumnName("department_id");
        builder.Property(i => i.InvitedBy).HasColumnName("invited_by").IsRequired();
        builder.Property(i => i.InvitationToken).HasColumnName("invitation_token").HasMaxLength(255).IsRequired();
        builder.Property(i => i.InvitationType).HasColumnName("invitation_type").HasConversion<string>().HasMaxLength(30).IsRequired();
        builder.Property(i => i.Role).HasColumnName("role").HasMaxLength(32).IsRequired();
        builder.Property(i => i.Status).HasColumnName("status").HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(i => i.ExpiresAt).HasColumnName("expires_at").IsRequired();
        builder.Property(i => i.SentAt).HasColumnName("sent_at");
        builder.Property(i => i.OpenedAt).HasColumnName("opened_at");
        builder.Property(i => i.AcceptedAt).HasColumnName("accepted_at");
        builder.Property(i => i.ReminderCount).HasColumnName("reminder_count").IsRequired();
        builder.Property(i => i.LastReminderSentAt).HasColumnName("last_reminder_sent_at");
        builder.Property(i => i.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
        builder.Property(i => i.InvitationData).HasColumnName("invitation_data").HasColumnType("jsonb");
        builder.Property(i => i.Demographics).HasColumnName("demographics").HasColumnType("jsonb");

        builder.HasIndex(i => i.InvitationToken).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(i => i.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(i => i.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.InvitedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
