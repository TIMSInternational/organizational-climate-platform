using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// A btree index on <c>survey_drafts.expires_at</c> (#278), the predicate the draft
    /// retention sweep runs and the only one the table had no index for -- it carried
    /// <c>IX_survey_drafts_company_id</c> and <c>IX_survey_drafts_user_id</c> and nothing else.
    ///
    /// <para><b>What it is for.</b> <c>SurveyDraftRetentionJob.PurgeAsync</c> runs
    /// <c>WHERE expires_at &lt;= $1</c> -- as a capped harvest for the hourly worker, and as one
    /// uncapped DELETE for <c>DELETE /surveys/drafts/expired</c>. Both were sequential scans.
    /// The steady state makes that worse rather than better: the TTL is 30 days and every
    /// autosave re-stamps <c>expires_at</c> (<c>SurveyDraftEndpoints</c>), so the sweep almost
    /// always matches nothing and read the whole table to find it.</para>
    ///
    /// <para><b>Measured, not assumed.</b> On 20,000 live drafts in postgres:16-alpine, freshly
    /// ANALYZEd, <c>EXPLAIN (ANALYZE, BUFFERS)</c> of the harvest goes from
    /// <c>Seq Scan ... Rows Removed by Filter: 20000</c>, 364 shared buffers, 2.9 ms, to
    /// <c>Index Scan using "IX_survey_drafts_expires_at"</c>, 2 shared buffers, 0.07 ms. The
    /// uncapped DELETE moves the same way, 364 buffers to 2. Buffers rather than milliseconds
    /// is the number that matters: the seq scan's cost is proportional to the table, so it is
    /// the growth that is being removed, not 3 ms.</para>
    ///
    /// <para><b>What it costs.</b> Writes. An autosave UPDATE changes <c>expires_at</c>, which
    /// is now an indexed column, so those updates are no longer HOT-eligible and each one
    /// maintains an index entry it did not before. That is a bounded per-write cost against an
    /// unbounded per-sweep one, which is why it is worth paying here; it would not be on a table
    /// that were written far more often than it is scanned.</para>
    ///
    /// <para><b>Not a partial index.</b> The tempting <c>WHERE expires_at &lt;= now()</c> is not
    /// available: index predicates must be IMMUTABLE and <c>now()</c> is STABLE, so Postgres
    /// rejects it.</para>
    ///
    /// <para><b>Deployment note.</b> Verified against <c>dotnet ef migrations script</c>: this
    /// emits exactly one statement, <c>CREATE INDEX "IX_survey_drafts_expires_at" ON
    /// survey_drafts (expires_at);</c>, inside the <c>START TRANSACTION</c> EF wraps every
    /// migration in. It is therefore not CONCURRENTLY -- CONCURRENTLY cannot run inside a
    /// transaction block -- so the build takes a SHARE lock on <c>survey_drafts</c> for its
    /// duration: concurrent reads are unaffected, concurrent INSERT/UPDATE/DELETE on that one
    /// table wait. Everything that writes <c>survey_drafts</c> waits, which is the wizard's
    /// create/save/autosave/recover routes and its per-draft DELETE (<c>SurveyDraftEndpoints</c>),
    /// and both sweeps in <c>SurveyDraftRetentionJob.PurgeAsync</c> -- the hourly retention tick
    /// and the uncapped form behind <c>DELETE /surveys/drafts/expired</c>. The sweep this index
    /// exists for is therefore itself among the blocked writers: a tick landing inside the build
    /// waits on the lock, and no rows are lost if it gives up waiting, because the sweep deletes
    /// strictly by <c>expires_at</c> and the next tick takes the same set.
    ///
    /// If this ever needs to go onto a large <c>survey_drafts</c>, the fix is a hand-written
    /// migration issuing the CREATE INDEX CONCURRENTLY through
    /// <c>migrationBuilder.Sql(..., suppressTransaction: true)</c>, which is the same escape
    /// hatch <c>AddSearchVectors</c> names. It was not used here because a failed CONCURRENTLY
    /// build leaves an INVALID index behind under the name the retry then collides with, and
    /// that is a worse trade than a lock held over a table this size.</para>
    ///
    /// <para><b>Down</b> drops the index. Nothing depends on it for correctness -- the sweep
    /// produces the same rows either way -- so reversing this is a performance change only.</para>
    /// </summary>
    public partial class AddSurveyDraftExpiresAtIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_survey_drafts_expires_at",
                table: "survey_drafts",
                column: "expires_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_survey_drafts_expires_at",
                table: "survey_drafts");
        }
    }
}
