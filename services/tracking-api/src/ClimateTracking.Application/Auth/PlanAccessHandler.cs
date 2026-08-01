using ClimateTracking.Domain.Entities;
using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.Application.Auth;

/// <summary>
/// Node/role/involvement scoping for a specific PlanDeAccion. Admin roles (company_admin,
/// super_admin) always pass; a leader passes for their own node only; anyone tagged as
/// involucrado or as the responsable_ejecucion gets read access to that one plan but not
/// write (only the node's leader or an admin can mutate it).
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
