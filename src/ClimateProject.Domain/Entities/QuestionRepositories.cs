namespace ClimateProject.Domain.Entities;

/// <summary>
/// A node in the hierarchy the question LIBRARY is filed under (#58, #112).
///
/// <para>Bilingual by construction, unlike <see cref="QuestionBankItem"/>: the legacy
/// <c>QuestionCategory</c> required both <c>name.en</c> and <c>name.es</c>, so there is no
/// attribution to do and <c>Language</c> would always be "both".</para>
///
/// <para><b>The hierarchy is the parent pointer and nothing else.</b> No level, no path. The
/// design originally carried both, justified as the treatment <see cref="Department"/> gets --
/// which was wrong twice over: Department carries only <see cref="Department.ParentDepartmentId"/>,
/// and the pipeline said to recompute them was deleted. Depth is derivable from the tree a caller
/// has already fetched, and a stored copy is a denormalisation that drifts from what it describes.</para>
///
/// <para><see cref="CompanyId"/> null means global. Global rows are readable by everyone in scope
/// and writable by SuperAdmin only -- the same split <c>BenchmarkEndpoints</c> enforces.</para>
/// </summary>
public class QuestionCategory
{
    public Guid Id { get; set; }

    /// <summary>Null means a platform-wide category, visible to every tenant.</summary>
    public Guid? CompanyId { get; set; }

    /// <summary>Null means a root. Self-referential; cycles are refused at the endpoint.</summary>
    public Guid? ParentCategoryId { get; set; }

    public required string NameEn { get; set; }
    public required string NameEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }

    /// <summary>Sibling ordering within one parent.</summary>
    public int Order { get; set; }

    /// <summary>Icon identifier for the UI. Free-form: the client owns the mapping.</summary>
    public string? Icon { get; set; }

    /// <summary>Hex colour for visual distinction, e.g. <c>#6B7280</c>.</summary>
    public string? Color { get; set; }

    public bool IsActive { get; set; } = true;
    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// One reusable question in the AUTHORING repository -- the library the picker reads (#58, #112).
///
/// <para>Distinct from <see cref="QuestionBankItem"/> and deliberately not merged with it, per #58:
/// *"They do not overlap in purpose and must not be merged."* This is the authoring surface -- a real
/// category hierarchy, a <see cref="Dimension"/>, and version chaining. The bank is the curation
/// surface: cross-corpus metrics, industry targeting, a flat string category.</para>
///
/// <para><b>Bilingual natively</b>, like its category: legacy <c>QuestionLibrary</c> required both
/// <c>text_es</c> and <c>text_en</c>, so <see cref="Language"/> is <c>both</c> and no #195
/// attribution applies.</para>
///
/// <para><b>No ReverseCoded.</b> The design carried it; nothing in this platform implements reverse
/// scoring and <see cref="Question"/> has no such column. Since instantiation is a COPY, the flag
/// would be dropped exactly when it began to matter -- inverting that question's contribution to its
/// dimension score with no error and no reconciliation failure. Reverse scoring is worth building,
/// as its own change, with the inversion inside <c>SurveyAggregation</c> so all five presentations
/// agree.</para>
/// </summary>
public class QuestionLibraryItem
{
    public Guid Id { get; set; }

    /// <summary>Null means a platform-wide item. SuperAdmin-only to write.</summary>
    public Guid? CompanyId { get; set; }

    public Guid QuestionCategoryId { get; set; }

    public required string TextEn { get; set; }
    public required string TextEs { get; set; }

    /// <summary>Always <c>both</c> here; carried so the column means the same thing on every content table.</summary>
    public string Language { get; set; } = "both";

    /// <summary>
    /// Constrained to the INTERSECTION of what both wizards accept, not to every type the platform
    /// knows. An item typed from the wider vocabulary could be authored and then be uninstantiable
    /// into one of the two surfaces the picker serves, which is a validation failure discovered at
    /// the worst possible moment.
    /// </summary>
    public required string Type { get; set; }

    public int? ScaleMin { get; set; }
    public int? ScaleMax { get; set; }
    public string? ScaleLabelMinEn { get; set; }
    public string? ScaleLabelMinEs { get; set; }
    public string? ScaleLabelMaxEn { get; set; }
    public string? ScaleLabelMaxEs { get; set; }

    /// <summary>The climate dimension this question measures, e.g. <c>engagement</c>. Free-form.</summary>
    public string? Dimension { get; set; }

    /// <summary>Incremented when the item is instantiated into a survey or a microclimate.</summary>
    public int UsageCount { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }

    public bool IsActive { get; set; } = true;
    public int Version { get; set; } = 1;

    /// <summary>The item this one supersedes. Self-referential; null for a first version.</summary>
    public Guid? PreviousVersionId { get; set; }

    public Guid CreatedBy { get; set; }
    public Guid? LastModifiedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// Option rows for a library item, carrying a stable locale-independent <see cref="Value"/>.
/// See <see cref="QuestionOption"/> for why this is rows and not index-aligned arrays -- the same
/// defect applies here, and legacy stored exactly those arrays (<c>options_en</c>/<c>options_es</c>).
/// </summary>
public class QuestionLibraryItemOption
{
    public Guid QuestionLibraryItemId { get; set; }
    public int Order { get; set; }
    public required string Value { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
}

/// <summary>A free-form tag on a library item. A row rather than an array so the picker's filter is an indexed join.</summary>
public class QuestionLibraryItemTag
{
    public Guid QuestionLibraryItemId { get; set; }
    public required string Tag { get; set; }
}

/// <summary>
/// One question in the CURATION repository -- the bank behind the admin page and the AI features
/// (#58, #110).
///
/// <para>Its distinguishing fields are all about choosing well across a corpus:
/// <see cref="UsageCount"/>, <see cref="ResponseRate"/>, <see cref="InsightScore"/>,
/// <see cref="Industry"/>, <see cref="CompanySize"/>, <see cref="IsAiGenerated"/>, and variations via
/// <see cref="ParentQuestionBankItemId"/>. Its category is a plain string with a subcategory beside
/// it -- flat, and it needs no hierarchy.</para>
///
/// <para><b>Monolingual in legacy, so #195 attribution applies here and only here.</b> Legacy
/// <c>QuestionBank.text</c> was one string; it routes into <see cref="TextEn"/>/<see cref="TextEs"/>
/// by the owning company's language, and <see cref="Language"/> records which single language that
/// was -- never <c>both</c>. A global item (<see cref="CompanyId"/> null) has no company to
/// attribute from and takes the platform fallback locale.</para>
///
/// <para><see cref="IsAiGenerated"/> and <see cref="InsightScore"/> are carried although the features
/// that populate them (#111) are gated on the #67 provider decision. Two unused columns cost nothing
/// and keep the shape stable.</para>
/// </summary>
public class QuestionBankItem
{
    public Guid Id { get; set; }

    /// <summary>Null means a platform-wide question, shared across tenants. SuperAdmin-only to write.</summary>
    public Guid? CompanyId { get; set; }

    public string? TextEn { get; set; }
    public string? TextEs { get; set; }

    /// <summary>One of <c>en</c>/<c>es</c> -- never <c>both</c>. See the type remarks.</summary>
    public string Language { get; set; } = "en";

    public required string Type { get; set; }

    /// <summary>A plain string, not a reference. The bank is flat by design.</summary>
    public required string Category { get; set; }
    public string? Subcategory { get; set; }

    public int? ScaleMin { get; set; }
    public int? ScaleMax { get; set; }
    public string? ScaleLabelMinEn { get; set; }
    public string? ScaleLabelMinEs { get; set; }
    public string? ScaleLabelMaxEn { get; set; }
    public string? ScaleLabelMaxEs { get; set; }

    /// <summary>Targeting: which industry this question suits. Free-form.</summary>
    public string? Industry { get; set; }

    /// <summary>Targeting: <c>startup</c>|<c>small</c>|<c>medium</c>|<c>large</c>|<c>enterprise</c>.</summary>
    public string? CompanySize { get; set; }

    public int UsageCount { get; set; }

    /// <summary>Percentage, 0-100. Populated by the metrics route, not by respondents.</summary>
    public double ResponseRate { get; set; }

    /// <summary>0-10. Reserved for #111; nothing writes it until the AI provider decision lands.</summary>
    public double InsightScore { get; set; }

    public DateTimeOffset? LastUsedAt { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsAiGenerated { get; set; }
    public int Version { get; set; } = 1;

    /// <summary>The question this one is a variation of. Self-referential.</summary>
    public Guid? ParentQuestionBankItemId { get; set; }

    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Option rows for a bank item. See <see cref="QuestionLibraryItemOption"/>.</summary>
public class QuestionBankItemOption
{
    public Guid QuestionBankItemId { get; set; }
    public int Order { get; set; }
    public required string Value { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
}

/// <summary>A free-form tag on a bank item.</summary>
public class QuestionBankItemTag
{
    public Guid QuestionBankItemId { get; set; }
    public required string Tag { get; set; }
}
