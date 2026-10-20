namespace ClimateProject.Domain.Entities;

public class Survey
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }

    // Paired language columns (#195). No consumer reads TitleEn/TitleEs directly:
    // everything goes through LocalizedContent.Resolve, which is what keeps a third
    // language a migration rather than a rewrite.
    public string? TitleEn { get; set; }
    public string? TitleEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }

    /// <summary>
    /// 'es' | 'en' | 'both'. Defaults to the owning company's language; 'both' is an
    /// explicit per-survey override, not the norm. This is the field the publish gate
    /// reads -- see ContentPublishValidation.
    /// </summary>
    public string Language { get; set; } = "en";

    public required string Type { get; set; }

    /// <summary>
    /// Which licensed climate service this survey is an instrument of, or <c>null</c> for none.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Deliberately NOT <see cref="Type"/>. The two are orthogonal taxonomies and #496 records the
    /// measurement: <see cref="Type"/> is cadence and purpose -- <c>periodic</c>, <c>pulse</c>,
    /// <c>exit</c> -- while a licensed service is a product line the customer bought. An
    /// "Encuesta Periodica" can be the general-climate instrument or the culture one, and nothing
    /// about its cadence says which. Metering on <see cref="Type"/> compared a licence's
    /// <c>general_climate</c> against a survey's <c>periodic</c> and therefore never matched: the
    /// intersection of the two vocabularies was empty, so no seat was ever spent.
    /// </para>
    /// <para>
    /// <c>null</c> means "not an instrument of any licensed service", and is the grandfathering
    /// path: every survey that existed before this column, and every survey created without
    /// choosing a service, is unmetered. A seat is only ever spent for a survey whose author said
    /// which service it belongs to.
    /// </para>
    /// </remarks>
    public string? ServiceType { get; set; }
    public DateTimeOffset StartDate { get; set; }
    public DateTimeOffset EndDate { get; set; }
    public string Status { get; set; } = "draft";
    public int ResponseCount { get; set; }
    public int? TargetAudienceCount { get; set; }
    public int Version { get; set; } = 1;
    public SurveySettings Settings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class SurveySettings
{
    public bool Anonymous { get; set; }
    public bool AllowPartialResponses { get; set; } = true;
    public bool RandomizeQuestions { get; set; }
    public bool ShowProgress { get; set; } = true;
    public bool AutoSave { get; set; } = true;
    public int? TimeLimitMinutes { get; set; }
    public int? ResponseLimit { get; set; }

    /// <summary>
    /// Ask a respondent who has no account to declare their own demographics before the
    /// first question.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Opt-in, and default <c>false</c> on purpose. The alternative considered was deriving
    /// it -- public access type, plus anonymous, plus the company has active demographic
    /// fields -- which would have needed no column at all. Rejected because all three are
    /// already true of surveys collecting responses right now, so deriving would have
    /// started asking live respondents questions nobody turned on.
    /// </para>
    /// <para>
    /// This is the only switch that lets a demographic reach a response WITHOUT passing
    /// <c>SurveyResponsePrivacy.Filter</c>'s write-time cohort floor, and it has to be,
    /// because a self-declared respondent has no population to be counted against -- the
    /// company may hold no roster at all. The floor for these values is applied at READ
    /// time instead, by the same <c>SurveyResultsPrivacy.MinimumSegmentRespondents</c>
    /// every results surface already uses. <c>AnonymityNotice</c>'s copy was rewritten in
    /// the same change: it promised that a detail leaving too small a group is not
    /// RECORDED, which this setting makes false.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Whether the respondent is asked the área and the company's own demographic fields
    /// before the questions.
    /// </summary>
    /// <remarks>
    /// Defaults TRUE since 2026-10-13: a climate QR asks these, and an opt-in default meant a
    /// QR survey segmented nothing unless an admin remembered a checkbox. It is still a
    /// per-survey setting, because a microclimate asks nothing -- though a microclimate is a
    /// different entity reached through <c>MicroclimateEndpoints</c> and does not read this at
    /// all, so flipping the default cannot start one asking.
    ///
    /// Only read for a respondent with no account; a signed-in one's demographics are
    /// snapshotted from their profile. See <c>AsksSelfDeclaredDemographics</c>.
    /// </remarks>
    public bool SelfDeclaredDemographics { get; set; } = true;

    /// <summary>
    /// Ask a respondent who has no account for their name (required) and email (optional),
    /// so the company can see WHO has answered and who has not -- never WHAT they answered.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Ruled 2026-10-12: "collect name and email because we need to know who has answered and
    /// who has not, but DON'T link them to their answers." The identity is written to
    /// <c>survey_participations</c>, a table with no response id, no session id, no
    /// demographics, no IP or user agent and a DATE rather than a timestamp, in its own
    /// statement after the response has committed. See
    /// <c>docs/decisions/participation-is-not-linked-to-answers.md</c>.
    /// </para>
    /// <para>
    /// The entity default stays <c>false</c>, like <see cref="Anonymous"/>'s: changing it would
    /// silently start asking every live survey materialised without the column. The CREATE path
    /// sets it on, so a survey made from today asks unless its author says otherwise.
    /// </para>
    /// </remarks>
    public bool CollectParticipantIdentity { get; set; }

    public bool NotificationSendInvitations { get; set; } = true;
    public bool NotificationSendReminders { get; set; } = true;
    public int NotificationReminderFrequencyDays { get; set; } = 3;

    // Tier 1 despite living in a settings blob: these two are emailed to respondents.
    public string? InvitationCustomMessageEn { get; set; }
    public string? InvitationCustomMessageEs { get; set; }
    public bool InvitationIncludeCredentials { get; set; }
    public bool InvitationSendImmediately { get; set; }
    public string? InvitationCustomSubjectEn { get; set; }
    public string? InvitationCustomSubjectEs { get; set; }
    public bool InvitationBrandingEnabled { get; set; }

    /// <summary>
    /// Whether a respondent WITHOUT an account gets one session only: reloading or coming back
    /// serves the form as it was first served, instead of the half they left.
    /// </summary>
    /// <remarks>
    /// Default FALSE, deliberately. Ruled 2026-10-13 after weighing the alternative: applying it
    /// per-respondent would have taken effect instantly on every live survey, and an Eagle
    /// respondent sixty items into eighty who reloaded would have lost the lot. A per-survey flag
    /// changes nothing until somebody ticks it.
    ///
    /// It withholds the ANSWERS, never the session id. On an anonymous survey that id is the only
    /// thing that can tell a retried request from a second respondent, so it goes on being minted
    /// and matched -- see `respondSession.ts` and `FindExistingResponseAsync`.
    ///
    /// Only for a respondent with no account; a signed-in mass-invite respondent keeps resume,
    /// which the same ruling requires.
    /// </remarks>
    public bool OneSessionOnly { get; set; }

    /// <summary>
    /// This survey's credential mode, or null to inherit the company's.
    ///
    /// <para>Resolved once by <c>CredentialModes.Resolve</c> on the create path and written
    /// here, exactly as <c>Language</c> is -- the one company-default-survey-override in
    /// this codebase that is actually wired, rather than claimed in the UI and read nowhere
    /// (see <c>CompanySettings.AnonymousSurveys</c>). Freezing it matters: credentials are
    /// mailed once, and a company setting changed afterwards must not imply a different
    /// shape for mail that has already gone out.</para>
    /// </summary>
    public string? CredentialMode { get; set; }
}
