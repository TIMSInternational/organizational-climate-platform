using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Gives <c>benchmarks.validation_status</c> the vocabulary constraint
    /// <c>prior_period_status</c> has had since #89. Until #90 nothing wrote anything but
    /// <c>'pending'</c> into it; #90 adds two more writers (validate and import), and a
    /// four-value enumeration in a varchar with three writers and no constraint is the shape a
    /// status drifts in.
    /// </summary>
    /// <inheritdoc />
    public partial class AddBenchmarkValidationStatusCheck : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Before the constraint, on the precedent AddBenchmarkPriorPeriodStatus set: a
            // single row holding anything outside the vocabulary would abort this migration,
            // and a migration that fails on the customer's data rather than on ours is the
            // worst place to discover a stray value. Nothing in the product has ever written
            // one -- the column defaults to 'pending' and only ever held it -- so this should
            // move zero rows; it is here so that "should" is not load-bearing. 'pending' is
            // the safe landing: it means "nobody has assessed this", which is true of a row
            // whose status we could not read, and running validate restores the real answer.
            migrationBuilder.Sql(
                "UPDATE benchmarks SET validation_status = 'pending' "
                + "WHERE validation_status NOT IN ('pending', 'verified', 'needs-review', 'failed');");

            migrationBuilder.AddCheckConstraint(
                name: "ck_benchmarks_validation_status",
                table: "benchmarks",
                sql: "validation_status IN ('pending', 'verified', 'needs-review', 'failed')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_benchmarks_validation_status",
                table: "benchmarks");
        }
    }
}
