using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.OrgStructure;

public interface IInvitationEmailSender
{
    Task SendAsync(UserInvitation invitation, CancellationToken cancellationToken);
}
