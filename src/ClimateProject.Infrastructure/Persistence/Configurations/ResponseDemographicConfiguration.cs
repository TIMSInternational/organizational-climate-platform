using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ResponseDemographicConfiguration : IEntityTypeConfiguration<ResponseDemographic>
{
    public void Configure(EntityTypeBuilder<ResponseDemographic> builder)
    {
        builder.ToTable("response_demographics");
        builder.HasKey(rd => new { rd.ResponseId, rd.Field });
        builder.Property(rd => rd.ResponseId).HasColumnName("response_id");
        builder.Property(rd => rd.Field).HasColumnName("field").HasMaxLength(100);
        builder.Property(rd => rd.Value).HasColumnName("value").HasColumnType("jsonb").IsRequired();

        builder.HasOne<Response>().WithMany().HasForeignKey(rd => rd.ResponseId);
    }
}
