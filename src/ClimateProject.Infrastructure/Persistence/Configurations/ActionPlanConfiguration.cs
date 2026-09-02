using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanConfiguration : IEntityTypeConfiguration<ActionPlan>
{
    public void Configure(EntityTypeBuilder<ActionPlan> builder)
    {
        builder.ToTable("action_plans");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Title).HasColumnName("title").HasMaxLength(300).IsRequired();
        builder.Property(a => a.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.DepartmentId).HasColumnName("department_id");
        builder.Property(a => a.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(a => a.DueDate).HasColumnName("due_date").IsRequired();
        builder.Property(a => a.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("not_started");
        builder.Property(a => a.Priority).HasColumnName("priority").HasMaxLength(20).IsRequired().HasDefaultValue("medium");
        builder.Property(a => a.AiRecommendations).HasColumnName("ai_recommendations").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(a => a.Tags).HasColumnName("tags").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(a => a.TemplateId).HasColumnName("template_id");
        builder.Property(a => a.SourceSurveyId).HasColumnName("source_survey_id");

        // source_insight_id is DELIBERATELY still a plain column: nothing in the schema records
        // which table it points at. `ai_insights` and `analytics_insights` are separate tables
        // with separate id spaces, the column is written unvalidated (ActionPlanEndpoints.cs:131)
        // and read by nothing, so picking a parent here would be a guess that the FK then makes
        // permanent. See docs/decisions/survey-foreign-keys.md, "Decision 1" -- #168.
        builder.Property(a => a.SourceInsightId).HasColumnName("source_insight_id");
        builder.Property(a => a.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(a => a.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.Status });
        builder.HasIndex(a => a.DueDate);

        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(a => a.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(a => a.TemplateId).OnDelete(DeleteBehavior.SetNull);

        // SetNull, matching the identically-named and identically-meaning
        // `survey_templates.source_survey_id` (SurveyTemplateConfiguration.cs:31). The column is
        // provenance -- "this plan came out of that survey" -- and losing the provenance is a far
        // smaller loss than losing the plan, which owns objectives, KPIs and progress updates that
        // all cascade from it. Restrict was rejected: DELETE /surveys/{id} succeeds today for any
        // response-less survey, and Restrict would turn that into a 500 for a survey somebody once
        // linked a plan to. Cascade was rejected: a live plan is human work, not a derived artefact.
        builder.HasOne<Survey>().WithMany().HasForeignKey(a => a.SourceSurveyId).OnDelete(DeleteBehavior.SetNull);
    }
}
