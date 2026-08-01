using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;

namespace ClimateTracking.UnitTests.Entities;

public class CacheEntitiesTests
{
    [Fact]
    public void NodoCache_requires_ExternalId_Nombre_and_LiderExternalId()
    {
        var nodo = new NodoCache
        {
            ExternalId = "ND-014",
            Nombre = "Comercial Exterior",
            LiderExternalId = "PER-0231",
            CantidadColaboradores = 8,
            Activo = true,
            LastSyncedAt = DateTimeOffset.UtcNow,
        };

        Assert.Equal("ND-014", nodo.ExternalId);
        Assert.Null(nodo.NodoPadreExternalId);
    }

    [Fact]
    public void PersonaCache_holds_correo_and_nodo_link()
    {
        var persona = new PersonaCache
        {
            ExternalId = "PER-0231",
            NombreCompleto = "Maria Rodriguez",
            Correo = "mrodriguez@procomer.com",
            NodoExternalId = "ND-014",
            LastSyncedAt = DateTimeOffset.UtcNow,
        };

        Assert.Equal("mrodriguez@procomer.com", persona.Correo);
    }

    [Fact]
    public void CicloEncuestaCache_holds_estado_enum()
    {
        var ciclo = new CicloEncuestaCache
        {
            ExternalId = "CIC-2026-Q3",
            FechaApertura = new DateOnly(2026, 7, 1),
            FechaCierre = new DateOnly(2026, 7, 15),
            NumeroPreguntas = 48,
            Estado = EstadoCicloEncuesta.Cerrado,
            LastSyncedAt = DateTimeOffset.UtcNow,
        };

        Assert.Equal(EstadoCicloEncuesta.Cerrado, ciclo.Estado);
    }

    [Fact]
    public void HallazgoCache_holds_benchmark_and_prior_year_percentages()
    {
        var hallazgo = new HallazgoCache
        {
            ExternalId = "HAL-00567",
            CicloExternalId = "CIC-2026-Q3",
            NodoExternalId = "ND-014",
            Categoria = "Reconocimiento",
            ResultadoPct = 0.62m,
            BenchmarkSectorPct = 0.71m,
            ResultadoAnioAnteriorPct = 0.58m,
            LastSyncedAt = DateTimeOffset.UtcNow,
        };

        Assert.Equal(0.71m, hallazgo.BenchmarkSectorPct);
    }
}
