using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyDraftConfiguration : IEntityTypeConfiguration<SurveyDraft>
{
    public void Configure(EntityTypeBuilder<SurveyDraft> builder)
    {
        builder.ToTable("survey_drafts");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(d => d.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(d => d.SessionId).HasColumnName("session_id").HasMaxLength(200).IsRequired();
        builder.Property(d => d.CurrentStep).HasColumnName("current_step").IsRequired().HasDefaultValue(1);
        builder.Property(d => d.LastEditedField).HasColumnName("last_edited_field").HasMaxLength(200);
        builder.Property(d => d.AutoSaveCount).HasColumnName("auto_save_count").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.Version).HasColumnName("version").IsRequired().HasDefaultValue(1);
        builder.Property(d => d.LastAutosaveAt).HasColumnName("last_autosave_at");
        builder.Property(d => d.ExpiresAt).HasColumnName("expires_at").IsRequired();
        builder.Property(d => d.IsRecovered).HasColumnName("is_recovered").IsRequired().HasDefaultValue(false);
        builder.Property(d => d.DraftData).HasColumnName("draft_data").HasColumnType("jsonb");
        builder.Property(d => d.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(d => d.UpdatedAt).HasColumnName("updated_at").IsRequired();

        // Serves the retention sweep's only predicate, `expires_at <= now`
        // (SurveyDraftRetentionJob.PurgeAsync, and DELETE /surveys/drafts/expired behind it).
        // Without it that predicate is a sequential scan (#278), on a table that grows with
        // every wizard autosave session and is swept hourly once the workers host runs.
        //
        // Not a partial index: the useful predicate would have to be `expires_at <= now()`,
        // and `now()` is not IMMUTABLE, so Postgres will not accept it in an index predicate.
        //
        // It is on expires_at alone, not (user_id, expires_at), and it does not serve the read
        // path -- which #278 guessed it would. The reads filter
        // `user_id = @me AND expires_at > now` (SurveyDraftEndpoints), and there the expiry half
        // matches nearly every row, because nearly every row is live. Measured: with drafts
        // spread over many authors the planner takes IX_survey_drafts_user_id and applies
        // expiry as a post-index Filter, exactly as it did before this index existed.
        builder.HasIndex(d => d.ExpiresAt);

        builder.HasOne<User>().WithMany().HasForeignKey(d => d.UserId);
        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId);
    }
}
