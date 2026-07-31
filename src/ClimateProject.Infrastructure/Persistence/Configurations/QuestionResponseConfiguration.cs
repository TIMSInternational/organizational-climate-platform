using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionResponseConfiguration : IEntityTypeConfiguration<QuestionResponse>
{
    public void Configure(EntityTypeBuilder<QuestionResponse> builder)
    {
        builder.ToTable("question_responses");
        builder.HasKey(qr => new { qr.ResponseId, qr.QuestionId });
        builder.Property(qr => qr.ResponseId).HasColumnName("response_id");
        builder.Property(qr => qr.QuestionId).HasColumnName("question_id");
        builder.Property(qr => qr.ResponseValue).HasColumnName("response_value").HasColumnType("jsonb").IsRequired();
        builder.Property(qr => qr.ResponseText).HasColumnName("response_text").HasColumnType("text");
        builder.Property(qr => qr.TimeSpentSeconds).HasColumnName("time_spent_seconds");

        builder.HasOne<Response>().WithMany().HasForeignKey(qr => qr.ResponseId);
        builder.HasOne<Question>().WithMany().HasForeignKey(qr => qr.QuestionId).OnDelete(DeleteBehavior.Restrict);
    }
}
