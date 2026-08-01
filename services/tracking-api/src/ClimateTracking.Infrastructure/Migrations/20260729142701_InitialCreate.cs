using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateTracking.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ciclos_encuesta_cache",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FechaApertura = table.Column<DateOnly>(type: "date", nullable: false),
                    FechaCierre = table.Column<DateOnly>(type: "date", nullable: false),
                    NumeroPreguntas = table.Column<int>(type: "integer", nullable: false),
                    Estado = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ciclos_encuesta_cache", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "hallazgos_cache",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CicloExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    NodoExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Categoria = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ResultadoPct = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    BenchmarkSectorPct = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    ResultadoAnioAnteriorPct = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hallazgos_cache", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "nodos_cache",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Nombre = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NodoPadreExternalId = table.Column<string>(type: "text", nullable: true),
                    LiderExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CantidadColaboradores = table.Column<int>(type: "integer", nullable: false),
                    Activo = table.Column<bool>(type: "boolean", nullable: false),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_nodos_cache", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "personas_cache",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    NombreCompleto = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Correo = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NodoExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_personas_cache", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "planes_de_accion",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PlanCode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    NodoExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    LiderExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    HallazgoExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    DescripcionQue = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    MetodologiaComo = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    ResponsableEjecucionExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FechaCreacion = table.Column<DateOnly>(type: "date", nullable: false),
                    FechaCompromiso = table.Column<DateOnly>(type: "date", nullable: false),
                    PorcentajeAvance = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    EstadoSemaforo = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CicloEncuestaExternalId = table.Column<string>(type: "text", nullable: true),
                    FechaUltimaActualizacion = table.Column<DateOnly>(type: "date", nullable: false),
                    Cumplido = table.Column<bool>(type: "boolean", nullable: false),
                    involucrados_external_ids = table.Column<List<string>>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_planes_de_accion", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "semaforo_threshold_config",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DiasAmarilloSinActualizar = table.Column<int>(type: "integer", nullable: false),
                    DiasRojoSinActualizar = table.Column<int>(type: "integer", nullable: false),
                    DiasAntesVencimientoAmarillo = table.Column<int>(type: "integer", nullable: false),
                    TipoAvanceEsperado = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Hitos = table.Column<int[]>(type: "integer[]", nullable: true),
                    FraccionMitadPlazo = table.Column<decimal>(type: "numeric(5,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_semaforo_threshold_config", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "bitacora_entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PlanDeAccionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Fecha = table.Column<DateOnly>(type: "date", nullable: false),
                    UsuarioExternalId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AvanceAnterior = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    AvanceNuevo = table.Column<decimal>(type: "numeric(5,4)", nullable: false),
                    Comentario = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bitacora_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_bitacora_entries_planes_de_accion_PlanDeAccionId",
                        column: x => x.PlanDeAccionId,
                        principalTable: "planes_de_accion",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notificaciones",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PlanDeAccionId = table.Column<Guid>(type: "uuid", nullable: false),
                    TipoDisparador = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Destinatarios = table.Column<string[]>(type: "text[]", nullable: false),
                    Canal = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FechaEnvio = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Contenido = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    EstadoEnvio = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notificaciones", x => x.Id);
                    table.ForeignKey(
                        name: "FK_notificaciones_planes_de_accion_PlanDeAccionId",
                        column: x => x.PlanDeAccionId,
                        principalTable: "planes_de_accion",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "semaforo_threshold_config",
                columns: new[] { "Id", "DiasAmarilloSinActualizar", "DiasAntesVencimientoAmarillo", "DiasRojoSinActualizar", "FraccionMitadPlazo", "Hitos", "TipoAvanceEsperado" },
                values: new object[] { new Guid("00000000-0000-0000-0000-000000000001"), 30, 30, 60, 0.5m, null, "Continuo" });

            migrationBuilder.CreateIndex(
                name: "IX_bitacora_entries_PlanDeAccionId",
                table: "bitacora_entries",
                column: "PlanDeAccionId");

            migrationBuilder.CreateIndex(
                name: "IX_ciclos_encuesta_cache_ExternalId",
                table: "ciclos_encuesta_cache",
                column: "ExternalId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_hallazgos_cache_ExternalId",
                table: "hallazgos_cache",
                column: "ExternalId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_nodos_cache_ExternalId",
                table: "nodos_cache",
                column: "ExternalId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_notificaciones_PlanDeAccionId",
                table: "notificaciones",
                column: "PlanDeAccionId");

            migrationBuilder.CreateIndex(
                name: "IX_personas_cache_ExternalId",
                table: "personas_cache",
                column: "ExternalId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_planes_de_accion_involucrados",
                table: "planes_de_accion",
                column: "involucrados_external_ids")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "IX_planes_de_accion_PlanCode",
                table: "planes_de_accion",
                column: "PlanCode",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "bitacora_entries");

            migrationBuilder.DropTable(
                name: "ciclos_encuesta_cache");

            migrationBuilder.DropTable(
                name: "hallazgos_cache");

            migrationBuilder.DropTable(
                name: "nodos_cache");

            migrationBuilder.DropTable(
                name: "notificaciones");

            migrationBuilder.DropTable(
                name: "personas_cache");

            migrationBuilder.DropTable(
                name: "semaforo_threshold_config");

            migrationBuilder.DropTable(
                name: "planes_de_accion");
        }
    }
}
