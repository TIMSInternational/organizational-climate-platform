using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.Application.Auth;

public enum AccessLevel
{
    Read,

    Write,

    /// <summary>
    /// Declaring a plan fulfilled -- <c>POST /api/planes-accion/{id}/cumplir</c>. Strictly
    /// narrower than <see cref="Write"/>, and deliberately so.
    ///
    /// Write admits the node's own leader, because a leader runs their area's plans: they
    /// record progress, move the date, edit the method. Fulfilment is a different act. It is
    /// the statement that the commitment was MET, it closes the plan out of the semaforo
    /// sweep, and the person best placed to record progress is the person least able to
    /// audit their own. So the client's rule -- "only one person marks it fulfilled" -- is
    /// expressed here as a role rather than a name: an administrator validates what the area
    /// reports. Ruled 2026-09-14; see <c>docs/decisions/tracking-fulfilment-authority.md</c>.
    /// </summary>
    Approve,
}

public sealed class PlanAccessRequirement(AccessLevel level) : IAuthorizationRequirement
{
    public AccessLevel Level { get; } = level;
}
