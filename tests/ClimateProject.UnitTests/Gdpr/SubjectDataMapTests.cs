using ClimateProject.Application.Gdpr;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace ClimateProject.UnitTests.Gdpr;

/// <summary>
/// The guard that keeps <see cref="SubjectDataMap"/> honest against the live EF model (#144).
///
/// <para>An access export that misses a table is a failed obligation, not a small bug, and
/// nothing in the exporter can notice a table nobody remembered. These tests re-derive the
/// facts from <c>ClimateProjectDbContext.Model</c> on every run: add an entity, add a
/// foreign key to <c>users</c>, or add an email column, and one of them goes red until
/// somebody has decided what the new thing holds.</para>
///
/// <para>No database is needed. EF builds the model from the configuration classes alone, so
/// the connection string below is never opened.</para>
/// </summary>
public class SubjectDataMapTests
{
    private static IModel Model()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql("Host=model-only;Database=model-only")
            .Options;
        using var db = new ClimateProjectDbContext(options);
        return db.Model;
    }

    private static IEnumerable<IEntityType> NonOwned(IModel model)
        => model.GetEntityTypes().Where(t => !t.IsOwned());

    [Fact]
    public void Every_non_owned_entity_type_is_classified()
    {
        var declared = SubjectDataMap.Entries.Select(e => e.Entity).ToHashSet(StringComparer.Ordinal);
        var missing = NonOwned(Model())
            .Select(t => t.ClrType.Name)
            .Where(name => !declared.Contains(name))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        Assert.True(
            missing.Count == 0,
            "These entity types hold rows that no subject-data classification covers, so an access export "
            + "cannot know whether to include them and an erasure cannot know whether to touch them. Add each "
            + "one to SubjectDataMap.Entries with a lawful basis, a retention rule and a rationale: "
            + string.Join(", ", missing));
    }

    [Fact]
    public void The_map_declares_nothing_the_model_does_not_have()
    {
        var actual = NonOwned(Model()).Select(t => t.ClrType.Name).ToHashSet(StringComparer.Ordinal);
        var phantom = SubjectDataMap.Entries
            .Select(e => e.Entity)
            .Where(name => !actual.Contains(name))
            .ToList();

        Assert.True(phantom.Count == 0, "Classified but not in the model: " + string.Join(", ", phantom));
    }

    [Fact]
    public void Owned_entity_types_are_not_listed_separately()
    {
        var declared = SubjectDataMap.Entries.Select(e => e.Entity).ToHashSet(StringComparer.Ordinal);
        var ownedButListed = Model().GetEntityTypes()
            .Where(t => t.IsOwned() && declared.Contains(t.ClrType.Name))
            .Select(t => t.ClrType.Name)
            .ToList();

        Assert.True(
            ownedButListed.Count == 0,
            "Owned types are columns of their owner's table and are exported and erased with the owner. "
            + "Listing one as a table of its own would double-count it and invite an erasure that treats it "
            + "separately from the row it lives in: " + string.Join(", ", ownedButListed));
    }

    [Fact]
    public void Every_declared_table_name_matches_the_model()
    {
        var model = Model();
        var mismatches = new List<string>();

        foreach (var entry in SubjectDataMap.Entries)
        {
            var entityType = NonOwned(model).FirstOrDefault(t => t.ClrType.Name == entry.Entity);
            if (entityType is null)
            {
                continue; // Covered by The_map_declares_nothing_the_model_does_not_have.
            }

            var table = entityType.GetTableName();
            if (!string.Equals(table, entry.Table, StringComparison.Ordinal))
            {
                mismatches.Add($"{entry.Entity}: map says '{entry.Table}', model says '{table}'");
            }
        }

        Assert.True(mismatches.Count == 0, string.Join("; ", mismatches));
    }

    [Fact]
    public void Every_declared_link_property_exists_on_its_entity()
    {
        var model = Model();
        var missing = new List<string>();

        foreach (var entry in SubjectDataMap.Entries)
        {
            var entityType = NonOwned(model).FirstOrDefault(t => t.ClrType.Name == entry.Entity);
            if (entityType is null)
            {
                continue;
            }

            foreach (var property in entry.LinkProperties)
            {
                if (entityType.FindProperty(property) is null)
                {
                    missing.Add($"{entry.Entity}.{property}");
                }
            }
        }

        Assert.True(
            missing.Count == 0,
            "The map names link properties that no longer exist. A rename that silently invalidates a link is "
            + "how an export starts returning nothing without failing: " + string.Join(", ", missing));
    }

    [Fact]
    public void Every_foreign_key_to_User_is_declared_as_a_link_property()
    {
        var model = Model();
        var user = model.FindEntityType(typeof(User))!;
        var undeclared = new List<string>();

        foreach (var fk in user.GetReferencingForeignKeys())
        {
            var declaring = fk.DeclaringEntityType;
            var owner = declaring.IsOwned() ? RootOwner(declaring) : declaring;

            var entry = SubjectDataMap.Find(owner.ClrType.Name);
            if (entry is null)
            {
                continue; // Covered by Every_non_owned_entity_type_is_classified.
            }

            // An owned type's key to its owner is not a person reference; it is the shared
            // primary key. Only the owner needs to declare a link.
            if (declaring.IsOwned())
            {
                continue;
            }

            foreach (var property in fk.Properties)
            {
                if (!entry.LinkProperties.Contains(property.Name, StringComparer.Ordinal))
                {
                    undeclared.Add($"{declaring.ClrType.Name}.{property.Name}");
                }
            }
        }

        Assert.True(
            undeclared.Count == 0,
            "These columns point at a user and the subject-data map does not know about them, so a subject "
            + "access export would not return the rows and an erasure would not consider them. Declare each "
            + "as a link property on its entry in SubjectDataMap.Entries: " + string.Join(", ", undeclared));
    }

    [Fact]
    public void Every_email_column_is_accounted_for()
    {
        var model = Model();
        var unaccounted = new List<string>();

        foreach (var entityType in model.GetEntityTypes())
        {
            var owner = entityType.IsOwned() ? RootOwner(entityType) : entityType;

            foreach (var property in entityType.GetProperties())
            {
                if (property.ClrType != typeof(string)
                    || !property.Name.Contains("Email", StringComparison.Ordinal))
                {
                    continue;
                }

                var key = $"{entityType.ClrType.Name}.{property.Name}";
                if (SubjectDataMap.EmailColumnExemptions.ContainsKey(key))
                {
                    continue;
                }

                var entry = SubjectDataMap.Find(owner.ClrType.Name);
                if (entry is null || entry.Link == SubjectLink.None)
                {
                    unaccounted.Add($"{key} (owning table is not classified as holding subject data)");
                    continue;
                }

                // An owned type is exported and erased through its owner and has no link of its
                // own; only a column on a table in the map has to be declared as a link.
                if (entityType.IsOwned())
                {
                    continue;
                }

                if (!entry.LinkProperties.Contains(property.Name, StringComparer.Ordinal))
                {
                    unaccounted.Add($"{key} (not declared as a link property)");
                }
            }
        }

        Assert.True(
            unaccounted.Count == 0,
            "An email address is a direct identifier, and it is the one that a foreign-key sweep of the model "
            + "misses -- user_invitations names its invitee by email alone, with no user row to point at. Every "
            + "email column must therefore be either a declared link property on its table's map entry, or "
            + "listed in SubjectDataMap.EmailColumnExemptions with a reason: " + string.Join(", ", unaccounted));
    }

    [Fact]
    public void Redacted_columns_all_exist_and_belong_to_exported_tables()
    {
        var model = Model();

        foreach (var key in SubjectDataMap.RedactedColumns)
        {
            var parts = key.Split('.');
            Assert.Equal(2, parts.Length);

            var entityType = NonOwned(model).FirstOrDefault(t => t.ClrType.Name == parts[0]);
            Assert.True(entityType is not null, $"{key}: no such entity type.");
            Assert.True(entityType!.FindProperty(parts[1]) is not null, $"{key}: no such property.");

            var entry = SubjectDataMap.Find(parts[0]);
            Assert.True(entry is not null, $"{key}: entity is not in the map.");
            Assert.True(
                entry!.Export == ExportTreatment.FullRecord,
                $"{key}: redaction only bites on a full-record export, and this table is exported as "
                + $"{entry.Export}. Either the redaction or the treatment is wrong.");
        }
    }

    /// <summary>
    /// Pins the two counts the map's own prose states, so the documentation cannot quietly
    /// stop being true. These are derived from the model, not copied from the map.
    /// </summary>
    [Fact]
    public void The_shape_of_the_foreign_key_graph_into_users_is_what_the_map_says_it_is()
    {
        var model = Model();
        var user = model.FindEntityType(typeof(User))!;

        var nonOwnedReferrers = user.GetReferencingForeignKeys()
            .Where(fk => !fk.DeclaringEntityType.IsOwned())
            .Select(fk => fk.DeclaringEntityType.ClrType.Name)
            .Concat([nameof(User)]) // users.manager_id points back at users.
            .Distinct(StringComparer.Ordinal)
            .ToList();

        // 30 since #58: QuestionCategory, QuestionLibraryItem and QuestionBankItem each carry an
        // authorship FK into users. QuestionLibraryItem has two (CreatedBy and LastModifiedBy) but
        // counts once here -- this is a census of referring TYPES, not of columns.
        Assert.Equal(30, nonOwnedReferrers.Count);

        var restricting = user.GetReferencingForeignKeys()
            .Where(fk => !fk.DeclaringEntityType.IsOwned() && fk.DeleteBehavior == DeleteBehavior.Restrict)
            .ToList();

        // SubjectErasure and SubjectDataMap both state this count as the structural reason
        // erasure pseudonymises instead of deleting. If it moves, the argument has to be
        // re-read, not the comment re-typed -- so, having re-read it for #58:
        //
        // The three additions are questions_categories.created_by, question_library_items.created_by
        // and question_bank_items.created_by. All three are authored business content whose
        // attribution outlives the author, exactly like survey_templates.created_by, so Restrict is
        // right for them and the argument is unchanged in kind. It moves UP, which strengthens it:
        // there is now more of the employer's authored record that a row delete would destroy.
        // (question_library_items.last_modified_by is SetNull and correctly absent here -- losing
        // the last editor's identity costs nothing, losing the author's costs provenance.)
        Assert.Equal(19, restricting.Count);
    }

    [Fact]
    public void Nothing_is_exported_or_erased_without_a_basis_and_a_rationale()
    {
        foreach (var entry in SubjectDataMap.Entries.Where(e => e.Link != SubjectLink.None))
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.LawfulBasis), $"{entry.Entity}: no lawful basis.");
            Assert.False(string.IsNullOrWhiteSpace(entry.Retention), $"{entry.Entity}: no retention rule.");
            Assert.False(string.IsNullOrWhiteSpace(entry.Rationale), $"{entry.Entity}: no rationale.");
            Assert.NotEqual(ExportTreatment.None, entry.Export);
            Assert.NotEqual(ErasureTreatment.NotApplicable, entry.Erasure);
            Assert.NotEmpty(entry.LinkProperties);
        }

        foreach (var entry in SubjectDataMap.Entries.Where(e => e.Link == SubjectLink.None))
        {
            Assert.Equal(ExportTreatment.None, entry.Export);
            Assert.Equal(ErasureTreatment.NotApplicable, entry.Erasure);
            Assert.Empty(entry.LinkProperties);
            Assert.False(string.IsNullOrWhiteSpace(entry.Rationale), $"{entry.Entity}: no rationale.");
        }
    }

    private static IEntityType RootOwner(IEntityType owned)
    {
        var current = owned;
        while (current.IsOwned() && current.FindOwnership()?.PrincipalEntityType is { } principal)
        {
            current = principal;
        }

        return current;
    }
}
