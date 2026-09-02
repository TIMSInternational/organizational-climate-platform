using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AnalyticsInsightConfiguration : IEntityTypeConfiguration<AnalyticsInsight>
{
    public void Configure(EntityTypeBuilder<AnalyticsInsight> builder)
    {
        builder.ToTable("analytics_insights");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.SurveyId).HasColumnName("survey_id");
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.DepartmentId).HasColumnName("department_id");
        builder.Property(a => a.AggregationType).HasColumnName("aggregation_type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.MetricType).HasColumnName("metric_type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.MetricName).HasColumnName("metric_name").HasMaxLength(200).IsRequired();
        builder.Property(a => a.MetricDescription).HasColumnName("metric_description").HasMaxLength(1000);
        builder.Property(a => a.TotalResponses).HasColumnName("total_responses").IsRequired();
        builder.Property(a => a.CalculationDate).HasColumnName("calculation_date").IsRequired();
        builder.Property(a => a.IsCurrent).HasColumnName("is_current").IsRequired().HasDefaultValue(true);
        builder.Property(a => a.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(a => a.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.IsCurrent });
        builder.HasIndex(a => a.SurveyId);
        builder.HasIndex(a => a.DepartmentId);
        builder.HasIndex(a => new { a.AggregationType, a.MetricType });
        builder.HasIndex(a => a.CalculationDate);

        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(a => a.DepartmentId).OnDelete(DeleteBehavior.SetNull);

        // SetNull, kept symmetric with ai_insights.survey_id on purpose: the two tables are
        // written by sibling endpoints with the same insert-time survey check
        // (AnalyticsInsightEndpoints.cs:97-116) and giving them opposite delete behaviour is how
        // survey_department_targets and microclimate_department_targets ended up disagreeing.
        // The rows it keeps are not free -- an analytics_insight owns metric_data and time_series
        // children -- but a metric whose survey has been deleted is stale, not wrong, and
        // `is_current` already exists to say so.
        builder.HasOne<Survey>().WithMany().HasForeignKey(a => a.SurveyId).OnDelete(DeleteBehavior.SetNull);
    }
}
