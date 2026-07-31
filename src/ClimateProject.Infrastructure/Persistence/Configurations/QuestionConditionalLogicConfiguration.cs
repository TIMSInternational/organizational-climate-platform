using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionConditionalLogicConfiguration : IEntityTypeConfiguration<QuestionConditionalLogic>
{
    public void Configure(EntityTypeBuilder<QuestionConditionalLogic> builder)
    {
        builder.ToTable("question_conditional_logic");
        builder.HasKey(c => c.QuestionId);
        builder.Property(c => c.QuestionId).HasColumnName("question_id");
        builder.Property(c => c.ConditionQuestionId).HasColumnName("condition_question_id");
        builder.Property(c => c.ConditionOperator).HasColumnName("condition_operator").HasMaxLength(20);
        builder.Property(c => c.ConditionValue).HasColumnName("condition_value").HasColumnType("jsonb");
        builder.Property(c => c.Action).HasColumnName("action").HasMaxLength(20);
        builder.Property(c => c.TargetQuestionId).HasColumnName("target_question_id");

        builder.HasOne<Question>().WithOne().HasForeignKey<QuestionConditionalLogic>(c => c.QuestionId);
        builder.HasOne<Question>().WithMany().HasForeignKey(c => c.ConditionQuestionId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Question>().WithMany().HasForeignKey(c => c.TargetQuestionId).OnDelete(DeleteBehavior.SetNull);
    }
}
