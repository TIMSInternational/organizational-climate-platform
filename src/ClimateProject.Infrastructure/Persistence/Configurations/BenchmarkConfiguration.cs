using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class BenchmarkConfiguration : IEntityTypeConfiguration<Benchmark>
{
    public void Configure(EntityTypeBuilder<Benchmark> builder)
    {
        builder.ToTable("benchmarks");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(b => b.Description).HasColumnName("description").HasMaxLength(2000).IsRequired();
        builder.Property(b => b.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(b => b.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(b => b.Source).HasColumnName("source").HasMaxLength(200).IsRequired();
        builder.Property(b => b.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(b => b.CompanySize).HasColumnName("company_size").HasMaxLength(50);
        builder.Property(b => b.Region).HasColumnName("region").HasMaxLength(100);
        builder.Property(b => b.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(b => b.CompanyId).HasColumnName("company_id");
        builder.Property(b => b.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(b => b.ValidationStatus).HasColumnName("validation_status").HasMaxLength(20).IsRequired().HasDefaultValue(BenchmarkValidationStatuses.Pending);
        builder.Property(b => b.QualityScore).HasColumnName("quality_score").IsRequired().HasDefaultValue(0d);
        builder.Property(b => b.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
        builder.Property(b => b.PriorPeriodBenchmarkId).HasColumnName("prior_period_benchmark_id");
        builder.Property(b => b.PriorPeriodStatus)
            .HasColumnName("prior_period_status")
            .HasMaxLength(20)
            .IsRequired()
            .HasDefaultValue(PriorPeriodStatuses.Unlinked);
        builder.Property(b => b.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(b => b.UpdatedAt).HasColumnName("updated_at").IsRequired();

        // The status and the pointer are one fact written twice, so the database refuses to
        // hold them in disagreement. Two separate paths write this pair -- benchmark create
        // and the prior-period endpoint -- and #90 adds import/bulk, which are exactly the
        // kind of second writer that sets an id and forgets the status. A row reading
        // `unlinked` while carrying a pointer would make the benchmarks page print "not
        // linked yet" over a real comparison; the reverse would make `linked` render a
        // trend with nothing behind it. Enforced here rather than in a handler because a
        // handler is the thing being guarded against.
        builder.ToTable(t => t.HasCheckConstraint(
            "ck_benchmarks_prior_period_status",
            "prior_period_status IN ('unlinked', 'linked', 'none') AND "
            + "((prior_period_status = 'linked') = (prior_period_benchmark_id IS NOT NULL))"));

        // The same guarantee prior_period_status has had since #89, and for the same reason:
        // validation_status is a four-value enumeration held in a varchar, three writers put
        // values into it (create, validate, import), and the benchmarks page branches on the
        // exact strings. Until #90 nothing wrote anything but 'pending', so the column's
        // vocabulary had never been tested by a second writer; #90 adds two. Written from
        // BenchmarkValidationStatuses.All rather than a literal list so the constraint and the
        // constants cannot drift -- a fifth status added to one and not the other is a failed
        // insert on a route that looks correct.
        builder.ToTable(t => t.HasCheckConstraint(
            "ck_benchmarks_validation_status",
            $"validation_status IN ({string.Join(", ", BenchmarkValidationStatuses.All.Select(s => $"'{s}'"))})"));

        builder.HasIndex(b => new { b.Type, b.Category });
        builder.HasIndex(b => new { b.CompanyId, b.IsActive });
        builder.HasIndex(b => new { b.Industry, b.CompanySize });
        builder.HasIndex(b => b.ValidationStatus);
        // Serves the candidate search and the backfill, both of which ask the same question:
        // "the other benchmarks of this company, in this category, of this type". Without it
        // every candidate lookup is a sequential scan of the whole table.
        builder.HasIndex(b => new { b.CompanyId, b.Category, b.Type });

        builder.HasOne<User>().WithMany().HasForeignKey(b => b.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(b => b.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Benchmark>().WithMany().HasForeignKey(b => b.PriorPeriodBenchmarkId).OnDelete(DeleteBehavior.Restrict);
    }
}
