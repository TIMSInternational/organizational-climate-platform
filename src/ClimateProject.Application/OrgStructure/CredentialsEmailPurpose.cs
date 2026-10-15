namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// Which message a credentials email carries. Both carry the same pair -- a username and a
/// freshly generated password -- and differ only in what they ask the reader to do.
///
/// <para>
/// There is no default, deliberately. Every <see cref="ICredentialsEmailSender.SendAsync"/>
/// call states its purpose and the compiler enforces it, because a silently defaulted flag is
/// how <c>Survey.Settings.InvitationIncludeCredentials</c> came to be read by no sender at all.
/// </para>
/// </summary>
public enum CredentialsEmailPurpose
{
    /// <summary>
    /// First contact: the account was created a moment ago from a spreadsheet row and its holder
    /// has never heard of it. Sent by the mass-invite import and by a single administrator-driven
    /// resend, where the reader may not have received the first message at all.
    /// </summary>
    Invitation = 0,

    /// <summary>
    /// A chase, asked for by the client in these words: *"a esos hay que mandarles un correo
    /// solicitándoles que, por favor, ingresen y lo hagan. En ese correo tienen que volver a
    /// recibir su usuario y contraseña otra vez."* Sent by the bulk resend behind the
    /// *Quién ya respondió* roster, whose whole purpose is the people who have not finished.
    /// </summary>
    Reminder = 1,
}
