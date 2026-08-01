using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateConfiguration : IEntityTypeConfiguration<Microclimate>
{
    public void Configure(EntityTypeBuilder<Microclimate> builder)
    {
        builder.ToTable("microclimates");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Title).HasColumnName("title").HasMaxLength(150).IsRequired();
        builder.Property(m => m.Description).HasColumnName("description").HasMaxLength(500);
        builder.Property(m => m.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(m => m.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(m => m.TemplateId).HasColumnName("template_id");
        builder.Property(m => m.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("draft");
        builder.Property(m => m.ResponseCount).HasColumnName("response_count").IsRequired().HasDefaultValue(0);
        builder.Property(m => m.TargetParticipantCount).HasColumnName("target_participant_count").IsRequired().HasDefaultValue(0);
        builder.Property(m => m.ParticipationRate).HasColumnName("participation_rate").IsRequired().HasDefaultValue(0d);
        builder.Property(m => m.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(m => m.UpdatedAt).HasColumnName("updated_at").IsRequired();

        // Optimistic concurrency token mapped to PostgreSQL's built-in "xmin" system column.
        // This requires no migration/schema change -- xmin already exists on every table --
        // it just makes EF Core detect lost updates (e.g. two concurrent response submissions)
        // instead of silently overwriting one with the other.
        builder.Property<uint>("RowVersion").IsRowVersion();

        builder.HasIndex(m => new { m.CompanyId, m.Status });

        builder.HasOne<Company>().WithMany().HasForeignKey(m => m.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(m => m.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<MicroclimateTemplate>().WithMany().HasForeignKey(m => m.TemplateId).OnDelete(DeleteBehavior.SetNull);

        builder.OwnsOne(m => m.Targeting, targeting =>
        {
            targeting.Property(t => t.RoleFilters).HasColumnName("targeting_role_filters");
            targeting.Property(t => t.TenureFilters).HasColumnName("targeting_tenure_filters");
            targeting.Property(t => t.CustomFilters).HasColumnName("targeting_custom_filters").HasColumnType("jsonb");
            targeting.Property(t => t.IncludeManagers).HasColumnName("targeting_include_managers").IsRequired().HasDefaultValue(true);
            targeting.Property(t => t.MaxParticipants).HasColumnName("targeting_max_participants");
        });

        builder.OwnsOne(m => m.Scheduling, scheduling =>
        {
            scheduling.Property(s => s.StartTime).HasColumnName("scheduling_start_time").IsRequired();
            scheduling.Property(s => s.EndTime).HasColumnName("scheduling_end_time").IsRequired();
            scheduling.Property(s => s.Timezone).HasColumnName("scheduling_timezone").HasMaxLength(100).IsRequired().HasDefaultValue("UTC");
            scheduling.Property(s => s.ReminderSchedule).HasColumnName("scheduling_reminder_schedule").HasColumnType("jsonb");
        });

        builder.OwnsOne(m => m.RealtimeSettings, realtime =>
        {
            realtime.Property(r => r.ShowLiveResults).HasColumnName("realtime_settings_show_live_results").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.AnonymousResponses).HasColumnName("realtime_settings_anonymous_responses").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.AllowComments).HasColumnName("realtime_settings_allow_comments").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.WordCloudEnabled).HasColumnName("realtime_settings_word_cloud_enabled").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.SentimentAnalysisEnabled).HasColumnName("realtime_settings_sentiment_analysis_enabled").IsRequired().HasDefaultValue(true);
            realtime.Property(r => r.ParticipationThreshold).HasColumnName("realtime_settings_participation_threshold").IsRequired().HasDefaultValue(3);
        });

        builder.OwnsOne(m => m.LiveResults, liveResults =>
        {
            liveResults.Property(l => l.SentimentScore).HasColumnName("live_results_sentiment_score").IsRequired().HasDefaultValue(0d);
            liveResults.Property(l => l.EngagementLevel).HasColumnName("live_results_engagement_level").HasMaxLength(10).IsRequired().HasDefaultValue("medium");
            liveResults.Property(l => l.TopThemes).HasColumnName("live_results_top_themes").IsRequired().HasDefaultValue(Array.Empty<string>());
            liveResults.Property(l => l.WordCloudData).HasColumnName("live_results_word_cloud_data").HasColumnType("jsonb");
            liveResults.Property(l => l.ResponseDistribution).HasColumnName("live_results_response_distribution").HasColumnType("jsonb");
        });
    }
}
