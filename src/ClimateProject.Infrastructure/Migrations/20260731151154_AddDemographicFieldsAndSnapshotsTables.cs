using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDemographicFieldsAndSnapshotsTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "demographic_fields",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    field = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    options = table.Column<List<string>>(type: "text[]", nullable: true),
                    required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_demographic_fields", x => x.Id);
                    table.ForeignKey(
                        name: "FK_demographic_fields_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "demographic_snapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    survey_id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    metadata_total_users = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    metadata_departments_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    metadata_roles_distribution = table.Column<string>(type: "jsonb", nullable: true),
                    metadata_tenure_distribution = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_demographic_snapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_demographic_snapshots_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_demographic_snapshots_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "demographic_snapshot_changes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    field = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    old_value = table.Column<string>(type: "jsonb", nullable: true),
                    new_value = table.Column<string>(type: "jsonb", nullable: true),
                    changed_by = table.Column<Guid>(type: "uuid", nullable: false),
                    timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_demographic_snapshot_changes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_demographic_snapshot_changes_demographic_snapshots_snapshot~",
                        column: x => x.snapshot_id,
                        principalTable: "demographic_snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_demographic_snapshot_changes_users_changed_by",
                        column: x => x.changed_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "demographic_snapshot_entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    department = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    role = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    tenure = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    location = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    team = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    level = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    custom_attributes = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_demographic_snapshot_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_demographic_snapshot_entries_demographic_snapshots_snapshot~",
                        column: x => x.snapshot_id,
                        principalTable: "demographic_snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_demographic_snapshot_entries_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_demographic_fields_company_id_field",
                table: "demographic_fields",
                columns: new[] { "company_id", "field" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_demographic_fields_company_id_order",
                table: "demographic_fields",
                columns: new[] { "company_id", "order" });

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshot_changes_changed_by",
                table: "demographic_snapshot_changes",
                column: "changed_by");

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshot_changes_snapshot_id",
                table: "demographic_snapshot_changes",
                column: "snapshot_id");

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshot_entries_department",
                table: "demographic_snapshot_entries",
                column: "department");

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshot_entries_role",
                table: "demographic_snapshot_entries",
                column: "role");

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshot_entries_snapshot_id",
                table: "demographic_snapshot_entries",
                column: "snapshot_id");

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshot_entries_user_id",
                table: "demographic_snapshot_entries",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshots_company_id_timestamp",
                table: "demographic_snapshots",
                columns: new[] { "company_id", "timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshots_created_by",
                table: "demographic_snapshots",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshots_survey_id_is_active",
                table: "demographic_snapshots",
                columns: new[] { "survey_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_demographic_snapshots_survey_id_version",
                table: "demographic_snapshots",
                columns: new[] { "survey_id", "version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "demographic_fields");

            migrationBuilder.DropTable(
                name: "demographic_snapshot_changes");

            migrationBuilder.DropTable(
                name: "demographic_snapshot_entries");

            migrationBuilder.DropTable(
                name: "demographic_snapshots");
        }
    }
}
