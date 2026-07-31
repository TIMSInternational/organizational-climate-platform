using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyDistributionConfiguration : IEntityTypeConfiguration<SurveyDistribution>
{
    public void Configure(EntityTypeBuilder<SurveyDistribution> builder)
    {
        builder.ToTable("survey_distributions");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(d => d.AccessType).HasColumnName("access_type").HasMaxLength(20).IsRequired().HasDefaultValue("tokenized");
        builder.Property(d => d.PublicUrl).HasColumnName("public_url").HasMaxLength(500);
        builder.Property(d => d.QrCodeUrl).HasColumnName("qr_code_url").HasMaxLength(500).IsRequired();
        builder.Property(d => d.QrCodeSvgUrl).HasColumnName("qr_code_svg_url").HasMaxLength(500);
        builder.Property(d => d.QrCodePngUrl).HasColumnName("qr_code_png_url").HasMaxLength(500);
        builder.Property(d => d.QrCodePdfUrl).HasColumnName("qr_code_pdf_url").HasMaxLength(500);
        builder.Property(d => d.TokenizedLinksGenerated).HasColumnName("tokenized_links_generated").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.RegeneratedCount).HasColumnName("regenerated_count").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.LastRegeneratedAt).HasColumnName("last_regenerated_at");
        builder.Property(d => d.LastRegeneratedBy).HasColumnName("last_regenerated_by");
        builder.Property(d => d.TotalAccesses).HasColumnName("total_accesses").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.UniqueVisitors).HasColumnName("unique_visitors").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.LastAccessedAt).HasColumnName("last_accessed_at");
        builder.Property(d => d.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(d => d.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(d => d.SurveyId).IsUnique();
        builder.HasIndex(d => d.PublicUrl).IsUnique().HasFilter("public_url IS NOT NULL");

        builder.HasOne<Survey>().WithOne().HasForeignKey<SurveyDistribution>(d => d.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(d => d.LastRegeneratedBy).OnDelete(DeleteBehavior.SetNull);

        builder.OwnsOne(d => d.AccessRules, ar =>
        {
            ar.Property(x => x.RequireLogin).HasColumnName("access_rules_require_login").IsRequired().HasDefaultValue(true);
            ar.Property(x => x.AllowAnonymous).HasColumnName("access_rules_allow_anonymous").IsRequired().HasDefaultValue(false);
            ar.Property(x => x.SingleResponse).HasColumnName("access_rules_single_response").IsRequired().HasDefaultValue(true);
            ar.Property(x => x.ActiveOutsideSchedule).HasColumnName("access_rules_active_outside_schedule").IsRequired().HasDefaultValue(false);
            ar.Property(x => x.AllowedDomains).HasColumnName("access_rules_allowed_domains").HasColumnType("text[]");
            ar.Property(x => x.BlockedIps).HasColumnName("access_rules_blocked_ips").HasColumnType("text[]");
            ar.Property(x => x.MaxResponses).HasColumnName("access_rules_max_responses");
        });

        builder.OwnsOne(d => d.QrCustomization, qr =>
        {
            qr.Property(x => x.ForegroundColor).HasColumnName("qr_customization_foreground_color").HasMaxLength(20).IsRequired().HasDefaultValue("#000000");
            qr.Property(x => x.BackgroundColor).HasColumnName("qr_customization_background_color").HasMaxLength(20).IsRequired().HasDefaultValue("#FFFFFF");
            qr.Property(x => x.LogoUrl).HasColumnName("qr_customization_logo_url").HasMaxLength(500);
            qr.Property(x => x.Size).HasColumnName("qr_customization_size").IsRequired().HasDefaultValue(300);
        });
    }
}
