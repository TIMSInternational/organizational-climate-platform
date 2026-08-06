using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// Who a notification is actually being delivered to.
///
/// <para>
/// This type exists because the delivery seam as #97 left it could not deliver anything.
/// <c>INotificationSender.SendAsync</c> took a <see cref="Notification"/>, and a
/// notification row carries a <c>user_id</c> -- not an address. A real sender had exactly
/// two ways out: query the users table per notification (which would have undone the
/// deliberately O(1)-round-trip bulk dispatch path -- see <c>DispatchBulkAsync</c>), or be
/// handed the recipient. Every call site already has the <see cref="User"/> row loaded, so
/// it is handed the recipient.
/// </para>
/// <para>
/// It carries <see cref="Language"/> for the same reason it carries the address: resolving
/// it at delivery time is the only way a sender can honour it, and re-reading the user row
/// to find it would reintroduce the query this type exists to avoid.
/// </para>
/// </summary>
/// <param name="UserId">The recipient's row id. Logged; never put in mail.</param>
/// <param name="EmailAddress">The address as stored. Validated by the transport, not here.</param>
/// <param name="Name">Display name, for the greeting and the To header.</param>
/// <param name="Language">
/// An <see cref="ContentLanguages.Locales"/> value -- never null, never a BCP-47 tag.
/// Normalised on construction so a stored "es-CO" or "EN" resolves rather than silently
/// falling through to English.
/// </param>
public sealed record NotificationRecipient(Guid UserId, string EmailAddress, string Name, string Language)
{
    /// <summary>
    /// Builds the recipient from the user row the dispatch path already loaded.
    /// </summary>
    /// <remarks>
    /// The language comes from <c>User.Preferences.Language</c>, which is the *display*
    /// preference -- and that is correct here, unlike for survey content. #195 keeps the two
    /// apart because a Spanish-speaking employee can legitimately be served an English-only
    /// survey: the survey's language is a property of the authored content. The chrome of a
    /// notification email is not authored content, it is product UI delivered by mail, so it
    /// follows the same setting the product UI follows.
    /// </remarks>
    public static NotificationRecipient From(User user)
    {
        ArgumentNullException.ThrowIfNull(user);

        return new NotificationRecipient(
            user.Id,
            user.Email,
            user.Name,
            ContentLanguages.NormaliseLocale(user.Preferences.Language) ?? ContentLanguages.FallbackLocale);
    }
}
