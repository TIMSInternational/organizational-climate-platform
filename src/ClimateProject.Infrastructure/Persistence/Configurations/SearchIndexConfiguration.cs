using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NpgsqlTypes;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// The full-text search columns and their GIN indexes, for every entity global search
/// (#145) can return.
///
/// One file rather than six one-line additions to the per-entity configurations, because
/// the interesting thing about these columns is that they are a *set* -- the search
/// surface -- and a reviewer needs to see the whole surface at once to judge whether it
/// leaks. They are declared here as EF **shadow** properties: the tsvector is a storage
/// concern of the search feature and nothing in the domain reads it, so
/// <c>Domain.Entities</c> stays free of an Npgsql type.
///
/// EF allows more than one <see cref="IEntityTypeConfiguration{TEntity}"/> per entity and
/// <c>ApplyConfigurationsFromAssembly</c> applies them all, so this composes with
/// <c>SurveyConfiguration</c> and friends instead of replacing anything.
///
/// Every column is <c>GENERATED ALWAYS AS (...) STORED</c>, so the index cannot drift from
/// the row: there is no trigger to forget and no backfill job to fall behind. It also
/// means writes pay for the tsvector, which is the right trade here -- these are
/// admin-authored rows written rarely and searched constantly.
/// </summary>
public sealed class SearchIndexConfiguration :
    IEntityTypeConfiguration<Survey>,
    IEntityTypeConfiguration<Question>,
    IEntityTypeConfiguration<Department>,
    IEntityTypeConfiguration<User>,
    IEntityTypeConfiguration<ActionPlan>,
    IEntityTypeConfiguration<Report>
{
    /// <summary>The EF shadow-property name every search query reads via <c>EF.Property</c>.</summary>
    public const string PropertyName = "SearchVector";

    /// <summary>The column name, identical on every searchable table.</summary>
    public const string ColumnName = "search_vector";

    /// <summary>
    /// The text-search configuration, used on both sides: it builds every
    /// <c>search_vector</c> here and parses every <c>to_tsquery</c> in
    /// <c>SearchQueries</c>. The two must agree or the index matches nothing.
    ///
    /// <c>simple</c> -- no stemming -- rather than <c>english</c>/<c>spanish</c>, and the
    /// reason is that half of what is searched carries no language marker at all. A
    /// department name, an action-plan title, a report title and a user's name are single
    /// columns with no companion <c>_es</c>, so any stemmer chosen for them is chosen
    /// blind, and a Spanish stemmer applied to English text (or the reverse) produces
    /// lexemes that match nothing anyone will type -- silently, with no error and no empty
    /// index to notice.
    ///
    /// <c>simple</c> never produces a *wrong* lexeme, and the prefix matching in
    /// <c>SearchQueryText</c> recovers most of what stemming would have given for
    /// type-ahead ("encuesta" is found by "encuest", "surveys" by "survey"). Trading
    /// recall on inflected full words for correctness in both languages is the right way
    /// round for a navigational search; #78's bilingual requirement is satisfied because
    /// both language columns feed the same vector, so a survey authored in Spanish is
    /// findable by its Spanish words and an English one by its English words.
    ///
    /// Not accent-folded. That needs the <c>unaccent</c> extension plus an IMMUTABLE
    /// wrapper around it before it can appear in a generated column, and adding an
    /// extension to production for "gestion" to find "Gestión" is a bigger decision than
    /// this issue should make on its own.
    /// </summary>
    public const string Configuration = "simple";

    public void Configure(EntityTypeBuilder<Survey> builder)
        => AddSearchVector(
            builder,
            "surveys",
            "to_tsvector('simple', coalesce(title_en, '') || ' ' || coalesce(title_es, '') || ' ' || coalesce(description_en, '') || ' ' || coalesce(description_es, ''))");

    public void Configure(EntityTypeBuilder<Question> builder)
        => AddSearchVector(
            builder,
            "questions",
            "to_tsvector('simple', coalesce(text_en, '') || ' ' || coalesce(text_es, ''))");

    public void Configure(EntityTypeBuilder<Department> builder)
        => AddSearchVector(
            builder,
            "departments",
            "to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))");

    // translate() splits the address so "acme" and "example" find alice@acme.example.com:
    // the simple configuration tokenises a whole address as a single 'email' lexeme, which
    // only a prefix of the entire address would ever match. translate is IMMUTABLE, so it
    // is legal in a generated column -- unlike most of the alternatives.
    public void Configure(EntityTypeBuilder<User> builder)
        => AddSearchVector(
            builder,
            "users",
            "to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || translate(coalesce(email, ''), '@._-', '    '))");

    public void Configure(EntityTypeBuilder<ActionPlan> builder)
        => AddSearchVector(
            builder,
            "action_plans",
            "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))");

    public void Configure(EntityTypeBuilder<Report> builder)
        => AddSearchVector(
            builder,
            "reports",
            "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))");

    // The table name is passed in rather than read off builder.Metadata: EF gives no
    // ordering guarantee between two configurations for the same entity, so if this one
    // runs before SurveyConfiguration then GetTableName() still answers "Surveys" and the
    // index would be named after a table that does not exist.
    private static void AddSearchVector<TEntity>(EntityTypeBuilder<TEntity> builder, string table, string sql)
        where TEntity : class
    {
        builder.Property<NpgsqlTsVector>(PropertyName)
            .HasColumnName(ColumnName)
            .HasComputedColumnSql(sql, stored: true);

        // GIN, not GiST: this index is read far more often than it is written, GIN is the
        // faster of the two to search, and it supports the prefix queries (`term:*`) that
        // type-ahead depends on.
        builder.HasIndex(PropertyName)
            .HasDatabaseName($"IX_{table}_{ColumnName}")
            .HasMethod("gin");
    }
}
