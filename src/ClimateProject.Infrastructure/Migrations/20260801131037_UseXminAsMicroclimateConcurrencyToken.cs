using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// No-op migration. This exists only to keep the EF Core model snapshot in sync after
    /// mapping <c>Microclimate</c> to use PostgreSQL's built-in "xmin" system column as an
    /// optimistic-concurrency token (see MicroclimateConfiguration.cs). "xmin" already exists
    /// on every PostgreSQL table -- it is not a real column to add or drop, so both migration
    /// directions are intentionally empty. (The default EF Core scaffolding for a `uint`
    /// row-version property emits an AddColumn/DropColumn pair, which would fail against a
    /// live database since "xmin" is a reserved system column that cannot be added or dropped.)
    /// </summary>
    public partial class UseXminAsMicroclimateConcurrencyToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Intentionally empty -- see class summary.
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Intentionally empty -- see class summary.
        }
    }
}
