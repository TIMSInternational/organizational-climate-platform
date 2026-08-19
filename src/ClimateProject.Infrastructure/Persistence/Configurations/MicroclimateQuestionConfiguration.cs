using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateQuestionConfiguration : IEntityTypeConfiguration<MicroclimateQuestion>
{
    public void Configure(EntityTypeBuilder<MicroclimateQuestion> builder)
    {
        builder.ToTable("microclimate_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(q => q.TextEn).HasColumnName("text_en").HasMaxLength(300);
        builder.Property(q => q.TextEs).HasColumnName("text_es").HasMaxLength(300);
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.Order).HasColumnName("question_order").IsRequired();
        // Provenance, same contract as questions.source_library_item_id (#58, #115): the picker
        // serves both wizards, so both instantiation targets carry the link back to the library.
        builder.Property(q => q.SourceLibraryItemId).HasColumnName("source_library_item_id");

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(q => q.MicroclimateId);
        // SetNull: retiring a library item must never delete questions already asked.
        builder.HasOne<QuestionLibraryItem>().WithMany().HasForeignKey(q => q.SourceLibraryItemId).OnDelete(DeleteBehavior.SetNull);
    }
}
