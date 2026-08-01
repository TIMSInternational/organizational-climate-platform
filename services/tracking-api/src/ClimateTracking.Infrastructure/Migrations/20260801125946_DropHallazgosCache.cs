using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateTracking.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DropHallazgosCache : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "hallazgos_cache");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "hallazgos_cache",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BenchmarkSectorPct = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    Categoria = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CicloExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    NodoExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResultadoAnioAnteriorPct = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    ResultadoPct = table.Column<decimal>(type: "numeric(5,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hallazgos_cache", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_hallazgos_cache_ExternalId",
                table: "hallazgos_cache",
                column: "ExternalId",
                unique: true);
        }
    }
}
