using ClimateProject.DataMigration.Legacy;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// Pins the census. The list below is written out independently rather than read from
/// <see cref="LegacyCollections"/>, so dropping, renaming or duplicating a reader is a
/// test failure, not a silent shrink of the migration's coverage.
/// </summary>
public class LegacyCollectionsTests
{
    // The 32 collections of the design doc's table, in its order, plus the three models
    // QuestionPool.ts also registers (doc addendum 2026-08-15). Names are Mongoose
    // pluralize() defaults, computed with the legacy repo's own pluralizer.
    private static readonly string[] ExpectedCollections =
    [
        "companies",
        "departments",
        "users",
        "systemsettings",
        "demographicfields",
        "demographicsnapshots",
        "surveys",
        "surveyversions",
        "surveydrafts",
        "surveytemplates",
        "surveydistributions",
        "surveyinvitations",
        "surveyauditlogs",
        "responses",
        "microclimates",
        "microclimatetemplates",
        "microclimateinvitations",
        "actionplans",
        "actionplantemplates",
        "aiinsights",
        "analyticsinsights",
        "benchmarks",
        "reports",
        "notifications",
        "notificationtemplates",
        "userinvitations",
        "auditlogs",
        "libraryquestions",
        "questionpools",
        "questionbanks",
        "questioncategories",
        "questionlibraries",
        "questioneffectivenesses",
        "questioncombinations",
        "questiongenerations",
    ];

    [Fact]
    public void Every_legacy_collection_has_exactly_one_reader()
    {
        Assert.Equal(ExpectedCollections, LegacyCollections.All.Select(reader => reader.CollectionName));
    }

    [Fact]
    public void No_two_collections_share_a_stub_type()
    {
        // Two collections deserializing into one CLR type would let a mapping written for
        // one silently apply to the other. One type per collection keeps sub-issue B's
        // field mappings collection-scoped by construction.
        var types = LegacyCollections.All.Select(reader => reader.DocumentType).ToList();

        Assert.Equal(types.Count, types.Distinct().Count());
    }

    [Fact]
    public void Every_stub_is_a_legacy_document()
    {
        // The Extra catch-all (see LegacyDocument) is the schemaless-Mongo defence; a stub
        // that bypassed the base class would silently drop undeclared fields instead.
        Assert.All(
            LegacyCollections.All,
            reader => Assert.True(reader.DocumentType.IsSubclassOf(typeof(LegacyDocument))));
    }
}
