using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateTracking.IntegrationTests;

public class ClimateTrackingDbContextTests(PostgresFixture fixture) : IClassFixture<PostgresFixture>
{
    private ClimateTrackingDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateTrackingDbContext>()
            .UseNpgsql(fixture.ConnectionString)
            .Options;
        var context = new ClimateTrackingDbContext(options);
        context.Database.Migrate();
        return context;
    }

    [Fact]
    public async Task Migrations_apply_cleanly_against_real_postgres()
    {
        await using var context = CreateContext();

        var pendingMigrations = await context.Database.GetPendingMigrationsAsync();

        Assert.Empty(pendingMigrations);
    }

    [Fact]
    public async Task PlanDeAccion_round_trips_with_bitacora_and_involucrados()
    {
        await using var context = CreateContext();
        var config = new SemaforoThresholdConfig();

        var plan = new PlanDeAccion
        {
            PlanCode = "PA-2026-00123",
            NodoExternalId = "ND-014",
            LiderExternalId = "PER-0231",
            DescripcionQue = "Implementar un programa mensual de reconocimiento entre pares",
            MetodologiaComo = "Nominacion por formulario simple",
            ResponsableEjecucionExternalId = "PER-0231",
            FechaCreacion = new DateOnly(2026, 7, 20),
            FechaCompromiso = new DateOnly(2026, 9, 15),
        };
        plan.AgregarInvolucrado("PER-0245");
        plan.AgregarInvolucrado("PER-0198");
        plan.RegistrarAvance(0.4m, "PER-0231", "Se diseno el formulario", new DateOnly(2026, 7, 20), config);

        context.PlanesDeAccion.Add(plan);
        await context.SaveChangesAsync();

        await using var readContext = CreateContext();
        var reloaded = await readContext.PlanesDeAccion
            .Include("_bitacora")
            .FirstAsync(p => p.PlanCode == "PA-2026-00123");

        Assert.Equal(EstadoSemaforo.Verde, reloaded.EstadoSemaforo);
        Assert.Equal(0.4m, reloaded.PorcentajeAvance);
        Assert.Single(reloaded.Bitacora);
        Assert.Equal(2, reloaded.InvolucradosExternalIds.Count);
    }

    [Fact]
    public async Task SemaforoThresholdConfig_round_trips_hitos_array()
    {
        await using var context = CreateContext();

        var seeded = await context.SemaforoThresholdConfigs
            .SingleAsync(c => c.Id == SemaforoThresholdConfig.DefaultConfigId);
        seeded.TipoAvanceEsperado = TipoAvanceEsperado.PorHito;
        seeded.Hitos = [25, 50, 75, 100];
        await context.SaveChangesAsync();

        await using var readContext = CreateContext();
        var reloaded = await readContext.SemaforoThresholdConfigs
            .SingleAsync(c => c.Id == SemaforoThresholdConfig.DefaultConfigId);

        Assert.Equal([25, 50, 75, 100], reloaded.Hitos!);
    }

    [Fact]
    public async Task RegistrarAvance_on_an_already_persisted_plan_succeeds_and_keeps_both_bitacora_entries()
    {
        var config = new SemaforoThresholdConfig();

        await using (var seedContext = CreateContext())
        {
            var plan = new PlanDeAccion
            {
                PlanCode = "PA-2026-00456",
                NodoExternalId = "ND-014",
                LiderExternalId = "PER-0231",
                DescripcionQue = "Implementar un programa mensual de reconocimiento entre pares",
                MetodologiaComo = "Nominacion por formulario simple",
                ResponsableEjecucionExternalId = "PER-0231",
                FechaCreacion = new DateOnly(2026, 7, 20),
                FechaCompromiso = new DateOnly(2026, 9, 15),
            };
            plan.RegistrarAvance(0.2m, "PER-0231", "Primer avance", new DateOnly(2026, 7, 20), config);

            seedContext.PlanesDeAccion.Add(plan);
            await seedContext.SaveChangesAsync();
        }

        await using (var updateContext = CreateContext())
        {
            var plan = await updateContext.PlanesDeAccion
                .Include("_bitacora")
                .SingleAsync(p => p.PlanCode == "PA-2026-00456");

            plan.RegistrarAvance(0.5m, "PER-0231", "Segundo avance", new DateOnly(2026, 8, 1), config);

            // This is the load-modify-save path: the plan row already exists, and the new
            // BitacoraEntry must be inserted (not mistaken for an update of a nonexistent row).
            await updateContext.SaveChangesAsync();
        }

        await using var readContext = CreateContext();
        var reloaded = await readContext.PlanesDeAccion
            .Include("_bitacora")
            .SingleAsync(p => p.PlanCode == "PA-2026-00456");

        Assert.Equal(0.5m, reloaded.PorcentajeAvance);
        Assert.Equal(2, reloaded.Bitacora.Count);
        Assert.Contains(reloaded.Bitacora, e => e.Comentario == "Primer avance");
        Assert.Contains(reloaded.Bitacora, e => e.Comentario == "Segundo avance");
    }
}
