using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyConfiguration : IEntityTypeConfiguration<Survey>
{
    public void Configure(EntityTypeBuilder<Survey> builder)
    {
        builder.ToTable("surveys");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(s => s.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(s => s.TitleEn).HasColumnName("title_en").HasMaxLength(200);
        builder.Property(s => s.TitleEs).HasColumnName("title_es").HasMaxLength(200);
        builder.Property(s => s.DescriptionEn).HasColumnName("description_en").HasMaxLength(1000);
        builder.Property(s => s.DescriptionEs).HasColumnName("description_es").HasMaxLength(1000);
        builder.Property(s => s.Language).HasColumnName("language").HasMaxLength(10).IsRequired().HasDefaultValue("en");
        builder.Property(s => s.Type).HasColumnName("type").HasMaxLength(30).IsRequired();
        builder.Property(s => s.StartDate).HasColumnName("start_date").IsRequired();
        builder.Property(s => s.EndDate).HasColumnName("end_date").IsRequired();
        builder.Property(s => s.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("draft");
        builder.Property(s => s.ResponseCount).HasColumnName("response_count").IsRequired().HasDefaultValue(0);
        builder.Property(s => s.TargetAudienceCount).HasColumnName("target_audience_count");
        builder.Property(s => s.Version).HasColumnName("version").IsRequired().HasDefaultValue(1);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.CreatedBy).OnDelete(DeleteBehavior.Restrict);

        builder.OwnsOne(s => s.Settings, settings =>
        {
            settings.Property(x => x.Anonymous).HasColumnName("settings_anonymous").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.AllowPartialResponses).HasColumnName("settings_allow_partial_responses").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.RandomizeQuestions).HasColumnName("settings_randomize_questions").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.ShowProgress).HasColumnName("settings_show_progress").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.AutoSave).HasColumnName("settings_auto_save").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.TimeLimitMinutes).HasColumnName("settings_time_limit_minutes");
            settings.Property(x => x.ResponseLimit).HasColumnName("settings_response_limit");
            settings.Property(x => x.NotificationSendInvitations).HasColumnName("settings_notification_send_invitations").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.NotificationSendReminders).HasColumnName("settings_notification_send_reminders").IsRequired().HasDefaultValue(true);
            settings.Property(x => x.NotificationReminderFrequencyDays).HasColumnName("settings_notification_reminder_frequency_days").IsRequired().HasDefaultValue(3);
            settings.Property(x => x.InvitationCustomMessageEn).HasColumnName("settings_invitation_custom_message_en").HasMaxLength(1000);
            settings.Property(x => x.InvitationCustomMessageEs).HasColumnName("settings_invitation_custom_message_es").HasMaxLength(1000);
            settings.Property(x => x.InvitationIncludeCredentials).HasColumnName("settings_invitation_include_credentials").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.InvitationSendImmediately).HasColumnName("settings_invitation_send_immediately").IsRequired().HasDefaultValue(false);
            settings.Property(x => x.InvitationCustomSubjectEn).HasColumnName("settings_invitation_custom_subject_en").HasMaxLength(200);
            settings.Property(x => x.InvitationCustomSubjectEs).HasColumnName("settings_invitation_custom_subject_es").HasMaxLength(200);
            settings.Property(x => x.InvitationBrandingEnabled).HasColumnName("settings_invitation_branding_enabled").IsRequired().HasDefaultValue(false);
        });
    }
}
