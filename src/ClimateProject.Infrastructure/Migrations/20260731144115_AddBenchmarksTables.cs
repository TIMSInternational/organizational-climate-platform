using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddBenchmarksTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "benchmarks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    source = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    industry = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    company_size = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    region = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    validation_status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    quality_score = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    prior_period_benchmark_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_benchmarks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_benchmarks_benchmarks_prior_period_benchmark_id",
                        column: x => x.prior_period_benchmark_id,
                        principalTable: "benchmarks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_benchmarks_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_benchmarks_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "benchmark_metrics",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    benchmark_id = table.Column<Guid>(type: "uuid", nullable: false),
                    metric_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    value = table.Column<double>(type: "double precision", nullable: false),
                    unit = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    percentile = table.Column<double>(type: "double precision", nullable: true),
                    sample_size = table.Column<int>(type: "integer", nullable: true),
                    confidence_interval_lower = table.Column<double>(type: "double precision", nullable: true),
                    confidence_interval_upper = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_benchmark_metrics", x => x.Id);
                    table.ForeignKey(
                        name: "FK_benchmark_metrics_benchmarks_benchmark_id",
                        column: x => x.benchmark_id,
                        principalTable: "benchmarks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_benchmark_metrics_benchmark_id",
                table: "benchmark_metrics",
                column: "benchmark_id");

            migrationBuilder.CreateIndex(
                name: "IX_benchmarks_company_id_is_active",
                table: "benchmarks",
                columns: new[] { "company_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_benchmarks_created_by",
                table: "benchmarks",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_benchmarks_industry_company_size",
                table: "benchmarks",
                columns: new[] { "industry", "company_size" });

            migrationBuilder.CreateIndex(
                name: "IX_benchmarks_prior_period_benchmark_id",
                table: "benchmarks",
                column: "prior_period_benchmark_id");

            migrationBuilder.CreateIndex(
                name: "IX_benchmarks_type_category",
                table: "benchmarks",
                columns: new[] { "type", "category" });

            migrationBuilder.CreateIndex(
                name: "IX_benchmarks_validation_status",
                table: "benchmarks",
                column: "validation_status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "benchmark_metrics");

            migrationBuilder.DropTable(
                name: "benchmarks");
        }
    }
}
