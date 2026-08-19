using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// The curation repository (#58/#110). Monolingual in legacy, so `language` records the ONE
// language its text is in -- never "both", which is what distinguishes it from the library.
public class QuestionBankItemConfiguration : IEntityTypeConfiguration<QuestionBankItem>
{
    public void Configure(EntityTypeBuilder<QuestionBankItem> builder)
    {
        builder.ToTable("question_bank_items");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.CompanyId).HasColumnName("company_id");
        builder.Property(i => i.TextEn).HasColumnName("text_en").HasMaxLength(500);
        builder.Property(i => i.TextEs).HasColumnName("text_es").HasMaxLength(500);
        builder.Property(i => i.Language).HasColumnName("language").HasMaxLength(10).IsRequired().HasDefaultValue("en");
        builder.Property(i => i.Type).HasColumnName("type").HasMaxLength(30).IsRequired();
        builder.Property(i => i.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(i => i.Subcategory).HasColumnName("subcategory").HasMaxLength(100);
        builder.Property(i => i.ScaleMin).HasColumnName("scale_min");
        builder.Property(i => i.ScaleMax).HasColumnName("scale_max");
        builder.Property(i => i.ScaleLabelMinEn).HasColumnName("scale_label_min_en").HasMaxLength(200);
        builder.Property(i => i.ScaleLabelMinEs).HasColumnName("scale_label_min_es").HasMaxLength(200);
        builder.Property(i => i.ScaleLabelMaxEn).HasColumnName("scale_label_max_en").HasMaxLength(200);
        builder.Property(i => i.ScaleLabelMaxEs).HasColumnName("scale_label_max_es").HasMaxLength(200);
        builder.Property(i => i.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(i => i.CompanySize).HasColumnName("company_size").HasMaxLength(50);
        builder.Property(i => i.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(i => i.ResponseRate).HasColumnName("response_rate").IsRequired().HasDefaultValue(0d);
        builder.Property(i => i.InsightScore).HasColumnName("insight_score").IsRequired().HasDefaultValue(0d);
        builder.Property(i => i.LastUsedAt).HasColumnName("last_used_at");
        builder.Property(i => i.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(i => i.IsAiGenerated).HasColumnName("is_ai_generated").IsRequired().HasDefaultValue(false);
        builder.Property(i => i.Version).HasColumnName("version").IsRequired().HasDefaultValue(1);
        builder.Property(i => i.ParentQuestionBankItemId).HasColumnName("parent_question_bank_item_id");
        builder.Property(i => i.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(i => i.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(i => i.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(i => new { i.CompanyId, i.IsActive });
        builder.HasIndex(i => new { i.Category, i.Subcategory });
        builder.HasIndex(i => new { i.Industry, i.CompanySize });

        builder.HasOne<Company>().WithMany().HasForeignKey(i => i.CompanyId).OnDelete(DeleteBehavior.SetNull);
        // Restrict, matching Benchmark's prior-period chain: a variation whose parent vanished
        // is a broken lineage, and silently severing it loses the only record of where it came from.
        builder.HasOne<QuestionBankItem>().WithMany().HasForeignKey(i => i.ParentQuestionBankItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
