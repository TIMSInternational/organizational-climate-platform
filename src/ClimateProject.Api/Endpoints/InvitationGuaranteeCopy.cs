using ClimateProject.Application.Localization;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The guarantee sentence that ships with every invitation-tracking payload
/// (<c>anonymity.guarantee</c>), in each locale the product publishes.
///
/// The sentence is the server's to write -- it states how far tracking goes for this
/// survey or microclimate, and the client renders it verbatim rather than re-deriving it
/// (see <c>DistributionProgress.tsx</c>). Until this class it existed in English only, so
/// the distribution page printed an English sentence over a Spanish screen: the one
/// server-authored string on that page that did not follow <c>?lang</c>. It follows it
/// now, resolved the same way as the survey's own content
/// (<see cref="SurveyContent.ResolveRequestLocale"/>), and an unknown locale falls back
/// to English exactly as content does.
/// </summary>
internal static class InvitationGuaranteeCopy
{
    public static string Survey(bool anonymous, string? locale)
        => ContentLanguages.NormaliseLocale(locale) == ContentLanguages.Spanish
            ? (anonymous
                ? "Esta encuesta es anónima. El seguimiento de invitaciones registra que una persona fue invitada "
                  + "y abrió la invitación, y se detiene ahí. Ni «iniciada» ni «completada» se guardan contra una "
                  + "persona, porque una marca de tiempo individual que afirme que existe una respuesta puede "
                  + "cruzarse por hora con las propias respuestas y reidentificar a quien respondió. La "
                  + "finalización solo está disponible como un recuento agregado."
                : "Esta encuesta no es anónima. El ciclo completo de la invitación se registra por cada persona "
                  + "invitada.")
            : (anonymous
                ? "This survey is anonymous. Invitation tracking records that a person was invited and opened "
                  + "the invitation, and stops there. Neither 'started' nor 'completed' is stored against an "
                  + "individual, because a per-person timestamp asserting a response exists can be joined on "
                  + "time against the responses themselves and re-identifies the respondent. Completion is "
                  + "only ever available as an aggregate count."
                : "This survey is not anonymous. The full invitation lifecycle is recorded per invitee.");

    public static string Microclimate(bool anonymous, string? locale)
        => ContentLanguages.NormaliseLocale(locale) == ContentLanguages.Spanish
            ? (anonymous
                ? "Este microclima es anónimo. El seguimiento de invitaciones registra que una persona fue "
                  + "invitada y abrió la invitación, y se detiene ahí. Ni «iniciada» ni «completada» se guardan "
                  + "contra una persona, porque una marca de tiempo individual que afirme que existe una "
                  + "respuesta puede cruzarse con el conteo de respuestas en vivo -- que este producto publica "
                  + "mientras la sesión está abierta -- y reidentificar a quien respondió. La participación solo "
                  + "está disponible como un recuento agregado."
                : "Este microclima no es anónimo; ya exige que quienes responden inicien sesión. El ciclo "
                  + "completo de la invitación se registra por cada persona invitada.")
            : (anonymous
                ? "This microclimate is anonymous. Invitation tracking records that a person was invited and "
                  + "opened the invitation, and stops there. Neither 'started' nor 'completed' is stored against "
                  + "an individual, because a per-person timestamp asserting a response exists can be lined up "
                  + "against the live response count -- which this product publishes while the session runs -- "
                  + "and re-identifies the respondent. Participation is only ever available as an aggregate count."
                : "This microclimate is not anonymous; it already requires respondents to sign in. The full "
                  + "invitation lifecycle is recorded per invitee.");
}
