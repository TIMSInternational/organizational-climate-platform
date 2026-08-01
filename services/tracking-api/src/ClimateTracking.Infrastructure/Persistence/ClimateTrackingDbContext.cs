using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateTracking.Infrastructure.Persistence;

public class ClimateTrackingDbContext(DbContextOptions<ClimateTrackingDbContext> options)
    : DbContext(options)
{
    public DbSet<NodoCache> Nodos => Set<NodoCache>();
    public DbSet<PersonaCache> Personas => Set<PersonaCache>();
    public DbSet<CicloEncuestaCache> CiclosEncuesta => Set<CicloEncuestaCache>();
    public DbSet<PlanDeAccion> PlanesDeAccion => Set<PlanDeAccion>();
    public DbSet<Notificacion> Notificaciones => Set<Notificacion>();
    public DbSet<SemaforoThresholdConfig> SemaforoThresholdConfigs => Set<SemaforoThresholdConfig>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateTrackingDbContext).Assembly);
    }
}
