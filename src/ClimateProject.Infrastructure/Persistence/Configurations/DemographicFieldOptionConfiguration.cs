using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// Stable-value option rows (#195). Shape and key deliberately mirror
// question_emoji_options, which already carried a stable Value beside a display
// label -- the house pattern existed two entities away and multiple-choice simply
// never adopted it.
public class DemographicFieldOptionConfiguration : IEntityTypeConfiguration<DemographicFieldOption>
{
    public void Configure(EntityTypeBuilder<DemographicFieldOption> builder)
    {
        builder.ToTable("demographic_field_options");
        builder.HasKey(o => new { o.DemographicFieldId, o.Order });
        builder.Property(o => o.DemographicFieldId).HasColumnName("demographic_field_id");
        builder.Property(o => o.Order).HasColumnName("order");
        // The locale-independent key. This -- never a label -- is what a respondent's
        // answer is validated against and stored as.
        builder.Property(o => o.Value).HasColumnName("value").HasMaxLength(500).IsRequired();
        builder.Property(o => o.LabelEn).HasColumnName("label_en").HasMaxLength(500);
        builder.Property(o => o.LabelEs).HasColumnName("label_es").HasMaxLength(500);

        // Two rows of the same parent must not share a value: the whole point of the
        // column is that it identifies the option, and a duplicate would make an
        // answer ambiguous in exactly the way this table exists to prevent.
        builder.HasIndex(o => new { o.DemographicFieldId, o.Value }).IsUnique();

        builder.HasOne<DemographicField>().WithMany().HasForeignKey(o => o.DemographicFieldId).OnDelete(DeleteBehavior.Cascade);
    }
}
