using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddQuestionRepositories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "source_library_item_id",
                table: "questions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "source_library_item_id",
                table: "microclimate_questions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "question_bank_items",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    text_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    text_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    language = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false, defaultValue: "en"),
                    type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    subcategory = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    scale_min = table.Column<int>(type: "integer", nullable: true),
                    scale_max = table.Column<int>(type: "integer", nullable: true),
                    scale_label_min_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_min_es = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_max_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_max_es = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    industry = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    company_size = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    usage_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    response_rate = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    insight_score = table.Column<double>(type: "double precision", nullable: false, defaultValue: 0.0),
                    last_used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    is_ai_generated = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    parent_question_bank_item_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_bank_items", x => x.Id);
                    table.ForeignKey(
                        name: "FK_question_bank_items_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_question_bank_items_question_bank_items_parent_question_ban~",
                        column: x => x.parent_question_bank_item_id,
                        principalTable: "question_bank_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_question_bank_items_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "question_categories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    parent_category_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name_es = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    description_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    icon = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    color = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_categories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_question_categories_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_question_categories_question_categories_parent_category_id",
                        column: x => x.parent_category_id,
                        principalTable: "question_categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_question_categories_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "question_bank_item_options",
                columns: table => new
                {
                    question_bank_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    label_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    label_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_bank_item_options", x => new { x.question_bank_item_id, x.order });
                    table.ForeignKey(
                        name: "FK_question_bank_item_options_question_bank_items_question_ban~",
                        column: x => x.question_bank_item_id,
                        principalTable: "question_bank_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_bank_item_tags",
                columns: table => new
                {
                    question_bank_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tag = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_bank_item_tags", x => new { x.question_bank_item_id, x.tag });
                    table.ForeignKey(
                        name: "FK_question_bank_item_tags_question_bank_items_question_bank_i~",
                        column: x => x.question_bank_item_id,
                        principalTable: "question_bank_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_library_items",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    company_id = table.Column<Guid>(type: "uuid", nullable: true),
                    question_category_id = table.Column<Guid>(type: "uuid", nullable: false),
                    text_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    text_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    language = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false, defaultValue: "both"),
                    type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    scale_min = table.Column<int>(type: "integer", nullable: true),
                    scale_max = table.Column<int>(type: "integer", nullable: true),
                    scale_label_min_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_min_es = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_max_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    scale_label_max_es = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    dimension = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    usage_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    previous_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    last_modified_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_library_items", x => x.Id);
                    table.ForeignKey(
                        name: "FK_question_library_items_companies_company_id",
                        column: x => x.company_id,
                        principalTable: "companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_question_library_items_question_categories_question_categor~",
                        column: x => x.question_category_id,
                        principalTable: "question_categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_question_library_items_question_library_items_previous_vers~",
                        column: x => x.previous_version_id,
                        principalTable: "question_library_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_question_library_items_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_question_library_items_users_last_modified_by",
                        column: x => x.last_modified_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "question_library_item_options",
                columns: table => new
                {
                    question_library_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    value = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    label_en = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    label_es = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_library_item_options", x => new { x.question_library_item_id, x.order });
                    table.ForeignKey(
                        name: "FK_question_library_item_options_question_library_items_questi~",
                        column: x => x.question_library_item_id,
                        principalTable: "question_library_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_library_item_tags",
                columns: table => new
                {
                    question_library_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tag = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_library_item_tags", x => new { x.question_library_item_id, x.tag });
                    table.ForeignKey(
                        name: "FK_question_library_item_tags_question_library_items_question_~",
                        column: x => x.question_library_item_id,
                        principalTable: "question_library_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_questions_source_library_item_id",
                table: "questions",
                column: "source_library_item_id");

            migrationBuilder.CreateIndex(
                name: "IX_microclimate_questions_source_library_item_id",
                table: "microclimate_questions",
                column: "source_library_item_id");

            migrationBuilder.CreateIndex(
                name: "IX_question_bank_item_options_question_bank_item_id_value",
                table: "question_bank_item_options",
                columns: new[] { "question_bank_item_id", "value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_question_bank_item_tags_tag",
                table: "question_bank_item_tags",
                column: "tag");

            migrationBuilder.CreateIndex(
                name: "IX_question_bank_items_category_subcategory",
                table: "question_bank_items",
                columns: new[] { "category", "subcategory" });

            migrationBuilder.CreateIndex(
                name: "IX_question_bank_items_company_id_is_active",
                table: "question_bank_items",
                columns: new[] { "company_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_question_bank_items_created_by",
                table: "question_bank_items",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_question_bank_items_industry_company_size",
                table: "question_bank_items",
                columns: new[] { "industry", "company_size" });

            migrationBuilder.CreateIndex(
                name: "IX_question_bank_items_parent_question_bank_item_id",
                table: "question_bank_items",
                column: "parent_question_bank_item_id");

            migrationBuilder.CreateIndex(
                name: "IX_question_categories_company_id_is_active",
                table: "question_categories",
                columns: new[] { "company_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_question_categories_created_by",
                table: "question_categories",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_question_categories_parent_category_id",
                table: "question_categories",
                column: "parent_category_id");

            migrationBuilder.CreateIndex(
                name: "IX_question_library_item_options_question_library_item_id_value",
                table: "question_library_item_options",
                columns: new[] { "question_library_item_id", "value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_question_library_item_tags_tag",
                table: "question_library_item_tags",
                column: "tag");

            migrationBuilder.CreateIndex(
                name: "IX_question_library_items_company_id_is_active",
                table: "question_library_items",
                columns: new[] { "company_id", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_question_library_items_created_by",
                table: "question_library_items",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_question_library_items_dimension",
                table: "question_library_items",
                column: "dimension");

            migrationBuilder.CreateIndex(
                name: "IX_question_library_items_last_modified_by",
                table: "question_library_items",
                column: "last_modified_by");

            migrationBuilder.CreateIndex(
                name: "IX_question_library_items_previous_version_id",
                table: "question_library_items",
                column: "previous_version_id");

            migrationBuilder.CreateIndex(
                name: "IX_question_library_items_question_category_id",
                table: "question_library_items",
                column: "question_category_id");

            migrationBuilder.AddForeignKey(
                name: "FK_microclimate_questions_question_library_items_source_librar~",
                table: "microclimate_questions",
                column: "source_library_item_id",
                principalTable: "question_library_items",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_questions_question_library_items_source_library_item_id",
                table: "questions",
                column: "source_library_item_id",
                principalTable: "question_library_items",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_microclimate_questions_question_library_items_source_librar~",
                table: "microclimate_questions");

            migrationBuilder.DropForeignKey(
                name: "FK_questions_question_library_items_source_library_item_id",
                table: "questions");

            migrationBuilder.DropTable(
                name: "question_bank_item_options");

            migrationBuilder.DropTable(
                name: "question_bank_item_tags");

            migrationBuilder.DropTable(
                name: "question_library_item_options");

            migrationBuilder.DropTable(
                name: "question_library_item_tags");

            migrationBuilder.DropTable(
                name: "question_bank_items");

            migrationBuilder.DropTable(
                name: "question_library_items");

            migrationBuilder.DropTable(
                name: "question_categories");

            migrationBuilder.DropIndex(
                name: "IX_questions_source_library_item_id",
                table: "questions");

            migrationBuilder.DropIndex(
                name: "IX_microclimate_questions_source_library_item_id",
                table: "microclimate_questions");

            migrationBuilder.DropColumn(
                name: "source_library_item_id",
                table: "questions");

            migrationBuilder.DropColumn(
                name: "source_library_item_id",
                table: "microclimate_questions");
        }
    }
}
