using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// Gives <c>benchmarks</c> a prior-period status, so that "there is no prior period" and
    /// "nobody has linked one yet" stop being the same stored value (#89).
    /// </summary>
    /// <inheritdoc />
    public partial class AddBenchmarkPriorPeriodStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "prior_period_status",
                table: "benchmarks",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "unlinked");

            // Between the column and the constraint, and it has to be: every existing row
            // takes the 'unlinked' default, and a row that already carries a
            // prior_period_benchmark_id would then contradict the CHECK below and abort this
            // migration on any database with even one linked benchmark in it. This is also
            // the first half of #89's backfill and the only half that can be done blind --
            // a row with a pointer IS linked, no inference required.
            migrationBuilder.Sql(
                "UPDATE benchmarks SET prior_period_status = 'linked' WHERE prior_period_benchmark_id IS NOT NULL;");

            migrationBuilder.CreateIndex(
                name: "IX_benchmarks_company_id_category_type",
                table: "benchmarks",
                columns: new[] { "company_id", "category", "type" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_benchmarks_prior_period_status",
                table: "benchmarks",
                sql: "prior_period_status IN ('unlinked', 'linked', 'none') AND ((prior_period_status = 'linked') = (prior_period_benchmark_id IS NOT NULL))");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_benchmarks_company_id_category_type",
                table: "benchmarks");

            migrationBuilder.DropCheckConstraint(
                name: "ck_benchmarks_prior_period_status",
                table: "benchmarks");

            migrationBuilder.DropColumn(
                name: "prior_period_status",
                table: "benchmarks");
        }
    }
}
