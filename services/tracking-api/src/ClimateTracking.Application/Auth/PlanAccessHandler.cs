using ClimateTracking.Domain.Entities;
using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.Application.Auth;

/// <summary>
/// Node/role/involvement scoping for a specific PlanDeAccion. Admin roles (company_admin,
/// super_admin) always pass; a leader passes for their own node only; anyone tagged as
/// involucrado or as the responsable_ejecucion gets read access to that one plan but not
/// write (only the node's leader or an admin can mutate it).
///
/// <see cref="AccessLevel.Approve"/> is the one level a leader does NOT reach: declaring a
/// plan fulfilled is an administrator's act, not the act of the area that ran it.
/// </summary>
public sealed class PlanAccessHandler : AuthorizationHandler<PlanAccessRequirement, PlanDeAccion>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PlanAccessRequirement requirement,
        PlanDeAccion plan)
    {
        var currentUser = context.User.GetCurrentUser();

        if (Roles.Admin.Contains(currentUser.Role))
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        // Admins have already succeeded above, so anything reaching here is not one -- and
        // Approve is theirs alone. A node leader running their own area is exactly the
        // caller this level exists to exclude.
        if (requirement.Level == AccessLevel.Approve)
        {
            return Task.CompletedTask;
        }

        var isNodeLeader = currentUser.Role == "leader" && currentUser.NodoExternalId == plan.NodoExternalId;
        if (isNodeLeader)
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        var isInvolved = plan.ResponsableEjecucionExternalId == currentUser.PersonaExternalId
            || plan.InvolucradosExternalIds.Contains(currentUser.PersonaExternalId);

        if (isInvolved && requirement.Level == AccessLevel.Read)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
