using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class CompanyConfiguration : IEntityTypeConfiguration<Company>
{
    public void Configure(EntityTypeBuilder<Company> builder)
    {
        builder.ToTable("companies");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(c => c.EmailDomain).HasColumnName("email_domain").HasMaxLength(255);
        builder.Property(c => c.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(c => c.Size).HasColumnName("size").HasConversion<string>().HasMaxLength(20);
        builder.Property(c => c.Country).HasColumnName("country").HasMaxLength(100);
        builder.Property(c => c.SubscriptionTier).HasColumnName("subscription_tier").HasConversion<string>().HasMaxLength(20);
        builder.Property(c => c.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.HasIndex(c => c.EmailDomain).IsUnique().HasFilter("email_domain IS NOT NULL");

        builder.OwnsOne(c => c.Branding, branding =>
        {
            branding.Property(b => b.LogoUrl).HasColumnName("branding_logo_url").HasMaxLength(500);
            branding.Property(b => b.PrimaryColor).HasColumnName("branding_primary_color").HasMaxLength(20).IsRequired();
            branding.Property(b => b.SecondaryColor).HasColumnName("branding_secondary_color").HasMaxLength(20).IsRequired();
            branding.Property(b => b.FontFamily).HasColumnName("branding_font_family").HasMaxLength(100).IsRequired();
            branding.Property(b => b.CustomCss).HasColumnName("branding_custom_css").HasColumnType("text");
        });

        builder.OwnsOne(c => c.Settings, settings =>
        {
            settings.Property(s => s.SurveyFrequency).HasColumnName("settings_survey_frequency").HasConversion<string>().HasMaxLength(20).IsRequired();
            settings.Property(s => s.MicroclimateEnabled).HasColumnName("settings_microclimate_enabled").IsRequired();
            settings.Property(s => s.AiInsightsEnabled).HasColumnName("settings_ai_insights_enabled").IsRequired();
            settings.Property(s => s.AnonymousSurveys).HasColumnName("settings_anonymous_surveys").IsRequired();
            settings.Property(s => s.DataRetentionDays).HasColumnName("settings_data_retention_days").IsRequired();
            settings.Property(s => s.Timezone).HasColumnName("settings_timezone").HasMaxLength(100).IsRequired();
            settings.Property(s => s.Language).HasColumnName("settings_language").HasMaxLength(10).IsRequired();
        });
    }
}
