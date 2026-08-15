using MongoDB.Bson;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The identity scheme is the migration's whole idempotency/resumability argument (design
/// doc, "Identity: deterministic GUIDs"), so its properties are pinned here: pure function,
/// collection-scoped, case-canonical, and agreeing with an independent RFC 4122 v5
/// implementation.
/// </summary>
public class MigrationIdsTests
{
    private static readonly ObjectId LegacyId = ObjectId.Parse("507f1f77bcf86cd799439011");

    [Fact]
    public void The_same_collection_and_id_always_derive_the_same_guid()
    {
        // Re-running the migration must derive the same keys, or every re-run duplicates
        // the database instead of upserting it.
        Assert.Equal(
            MigrationIds.For("users", LegacyId),
            MigrationIds.For("users", LegacyId));
    }

    [Fact]
    public void The_same_id_in_different_collections_derives_different_guids()
    {
        // The collection prefix in the derivation is what keeps two collections' id spaces
        // apart. Without it, a user and a company that happened to share a Mongo _id would
        // collide on one target Guid and the second insert would silently vanish into the
        // first's upsert.
        Assert.NotEqual(
            MigrationIds.For("users", LegacyId),
            MigrationIds.For("companies", LegacyId));
    }

    [Fact]
    public void The_derivation_agrees_with_an_independent_rfc_4122_v5_implementation()
    {
        // Both vectors computed with Python's uuid.uuid5 over the same namespace and
        // "collection:hex" name. This is the cross-implementation proof: reconciliation
        // tooling written in any language must be able to re-derive these ids, so the
        // scheme cannot be "whatever the .NET code happens to do".
        Assert.Equal(
            new Guid("2a0e96b5-14ec-51c5-b365-ed015dee4159"),
            MigrationIds.For("users", LegacyId));
        Assert.Equal(
            new Guid("867c27f0-7ae8-5bea-8ad4-355af228aa9a"),
            MigrationIds.For("companies", LegacyId));
    }

    [Fact]
    public void The_namespace_is_pinned_and_may_never_change()
    {
        // Recorded in the design doc's 2026-08-15 addendum. Changing it re-keys the entire
        // migrated database; this test exists so that change cannot happen as a casual edit.
        Assert.Equal(
            new Guid("1ad51692-845e-4f16-ac97-c8f692842472"),
            MigrationIds.MigrationNamespace);
    }

    [Fact]
    public void A_reference_stored_as_uppercase_hex_derives_the_documents_own_id()
    {
        // Legacy references are unvalidated strings; case must not fork the id space.
        Assert.Equal(
            MigrationIds.For("users", LegacyId),
            MigrationIds.For("users", "507F1F77BCF86CD799439011"));
    }

    [Theory]
    [InlineData("undefined")]
    [InlineData("not-an-objectid")]
    [InlineData("507f1f77bcf86cd79943901")] // 23 chars - one short
    public void A_malformed_legacy_reference_is_refused_not_keyed(string malformed)
    {
        // Dangling and malformed references go to the data-quality report. An id derived
        // from garbage would be a valid-looking key pointing at nothing, unfindable later.
        Assert.Throws<ArgumentException>(() => MigrationIds.For("users", malformed));
    }

    [Fact]
    public void An_empty_reference_is_refused_not_keyed()
    {
        Assert.Throws<ArgumentException>(() => MigrationIds.For("users", ""));
    }
}
