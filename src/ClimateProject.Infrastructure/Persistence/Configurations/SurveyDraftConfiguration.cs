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

        builder.HasOne<User>().WithMany().HasForeignKey(d => d.UserId);
        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId);
    }
}
