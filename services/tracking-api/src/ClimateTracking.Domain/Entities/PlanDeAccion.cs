using ClimateTracking.Domain.Enums;

namespace ClimateTracking.Domain.Entities;

public class PlanDeAccion
{
    public Guid Id { get; set; }
    public required string PlanCode { get; set; }
    public required string NodoExternalId { get; set; }
    public required string LiderExternalId { get; set; }
    public string? HallazgoExternalId { get; set; }
    public required string DescripcionQue { get; set; }
    public required string MetodologiaComo { get; set; }
    public required string ResponsableEjecucionExternalId { get; set; }
    public DateOnly FechaCreacion { get; set; }
    public DateOnly FechaCompromiso { get; set; }
    public decimal PorcentajeAvance { get; private set; }
    public EstadoSemaforo EstadoSemaforo { get; private set; } = EstadoSemaforo.Verde;
    public string? CicloEncuestaExternalId { get; set; }
    public DateOnly FechaUltimaActualizacion { get; private set; }
    public bool Cumplido { get; private set; }

    private readonly List<string> _involucradosExternalIds = [];
    public IReadOnlyList<string> InvolucradosExternalIds => _involucradosExternalIds;

    private readonly List<BitacoraEntry> _bitacora = [];
    public IReadOnlyList<BitacoraEntry> Bitacora => _bitacora;

    public void AgregarInvolucrado(string personaExternalId)
    {
        if (!_involucradosExternalIds.Contains(personaExternalId))
        {
            _involucradosExternalIds.Add(personaExternalId);
        }
    }

    public void MarcarCumplido(DateOnly fecha, string usuarioId)
    {
        var anterior = PorcentajeAvance;
        Cumplido = true;
        PorcentajeAvance = 1m;
        FechaUltimaActualizacion = fecha;
        EstadoSemaforo = EstadoSemaforo.Verde;

        _bitacora.Add(new BitacoraEntry
        {
            PlanDeAccionId = Id,
            Fecha = fecha,
            UsuarioExternalId = usuarioId,
            AvanceAnterior = anterior,
            AvanceNuevo = 1m,
            Comentario = "Plan marcado como cumplido",
        });
    }

    public void RegistrarAvance(
        decimal nuevoAvance,
        string usuarioId,
        string? comentario,
        DateOnly fecha,
        SemaforoThresholdConfig config)
    {
        if (nuevoAvance is < 0 or > 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(nuevoAvance), "porcentaje_avance debe estar entre 0 y 1");
        }

        var anterior = PorcentajeAvance;
        PorcentajeAvance = nuevoAvance;
        FechaUltimaActualizacion = fecha;

        _bitacora.Add(new BitacoraEntry
        {
            PlanDeAccionId = Id,
            Fecha = fecha,
            UsuarioExternalId = usuarioId,
            AvanceAnterior = anterior,
            AvanceNuevo = nuevoAvance,
            Comentario = comentario,
        });

        RecalcularSemaforo(fecha, config);
    }

    public void RecalcularSemaforo(DateOnly fechaActual, SemaforoThresholdConfig config)
    {
        if (Cumplido)
        {
            EstadoSemaforo = EstadoSemaforo.Verde;
            return;
        }

        var diasRestantes = FechaCompromiso.DayNumber - fechaActual.DayNumber;
        var diasSinActualizar = fechaActual.DayNumber - FechaUltimaActualizacion.DayNumber;
        var avanceEsperado = CalcularAvanceEsperado(fechaActual, config);

        if (diasRestantes < 0)
        {
            EstadoSemaforo = EstadoSemaforo.Rojo; // vencido sin cumplir
            return;
        }

        if (PorcentajeAvance == 0 && avanceEsperado >= config.FraccionMitadPlazo)
        {
            EstadoSemaforo = EstadoSemaforo.Rojo; // sin avance a mitad de plazo
            return;
        }

        if (diasSinActualizar > config.DiasRojoSinActualizar)
        {
            EstadoSemaforo = EstadoSemaforo.Rojo; // abandonado
            return;
        }

        if (diasRestantes <= config.DiasAntesVencimientoAmarillo && PorcentajeAvance < avanceEsperado)
        {
            EstadoSemaforo = EstadoSemaforo.Amarillo; // proximo a vencer, atrasado
            return;
        }

        if (diasSinActualizar > config.DiasAmarilloSinActualizar)
        {
            EstadoSemaforo = EstadoSemaforo.Amarillo; // sin novedades recientes
            return;
        }

        EstadoSemaforo = EstadoSemaforo.Verde;
    }

    public decimal CalcularAvanceEsperado(DateOnly fechaActual, SemaforoThresholdConfig config)
    {
        var diasTotales = FechaCompromiso.DayNumber - FechaCreacion.DayNumber;
        if (diasTotales <= 0)
        {
            return 1m;
        }

        var diasTranscurridos = fechaActual.DayNumber - FechaCreacion.DayNumber;
        var fraccion = Math.Clamp((decimal)diasTranscurridos / diasTotales, 0m, 1m);

        if (config.TipoAvanceEsperado == TipoAvanceEsperado.Continuo || config.Hitos is not { Length: > 0 })
        {
            return fraccion;
        }

        var hitoAlcanzado = 0;
        foreach (var hito in config.Hitos.OrderBy(h => h))
        {
            var hitoFraccion = hito / 100m;
            if (hitoFraccion <= fraccion)
            {
                hitoAlcanzado = hito;
            }
        }

        return hitoAlcanzado / 100m;
    }
}
