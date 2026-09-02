using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ClimateProject.Infrastructure.Migrations
{
    /// <summary>
    /// #168. Four <c>uuid</c> columns named for <c>surveys</c> had no foreign key at all:
    /// <c>action_plans.source_survey_id</c>, <c>ai_insights.survey_id</c>,
    /// <c>analytics_insights.survey_id</c> and <c>demographic_snapshots.survey_id</c>. Three of
    /// the four are checked by hand at insert time; none of the four was checked at delete time,
    /// which is the half that matters, because <c>SurveyEndpoints.cs:930</c> <b>hard-deletes</b>
    /// a survey (<c>db.Surveys.Remove</c>) rather than archiving it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The design question here is <c>ON DELETE</c>, and the answer is not the same for all
    /// four.</b> A survey can only be hard-deleted when it has zero responses
    /// (<c>SurveyEndpoints.DeleteSurveyAsync</c> returns 409 otherwise), so this is not a
    /// hypothetical: the delete path is live and it works today. A restrictive constraint would
    /// break it -- a 500 on an endpoint that currently returns 204 -- and a cascading one would
    /// silently delete rows a person wrote. Each column's choice is argued at its own statement
    /// below, and again in <c>docs/decisions/survey-foreign-keys.md</c>.
    /// </para>
    /// <para>
    /// <b>Two of the schema review's items are deliberately NOT in this migration</b>, because
    /// they need a ruling from a person rather than a defensible default:
    /// <c>action_plans.source_insight_id</c> (no declared parent table -- <c>ai_insights</c> and
    /// <c>analytics_insights</c> are different tables) and <c>notification_templates.created_by</c>
    /// (the only one of sixteen actor columns into <c>users</c> that cascades). Both are written
    /// up in <c>docs/decisions/survey-foreign-keys.md</c> with the options and what each costs.
    /// </para>
    /// <para>
    /// <b>This runs against a production database that already holds data.</b> A constraint that
    /// cannot be created is a failed deploy, so, on the precedent set by
    /// <c>AddBenchmarkValidationStatusCheck</c>, every statement below is preceded by the repair
    /// that makes it creatable and reports what it moved. Orphan counts on production were NOT
    /// measured before writing this (no read access to the production database from where it was
    /// written), which is exactly why the migration measures them itself and prints the numbers
    /// into the deploy log rather than assuming a zero.
    /// </para>
    /// </remarks>
    /// <inheritdoc />
    public partial class AddSurveyForeignKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ai_insights, analytics_insights and demographic_snapshots already index survey_id
            // as a leading column, so EF adds no index for them. action_plans.source_survey_id
            // has none, and an unindexed child column would make every survey delete a sequential
            // scan of action_plans to service the SET NULL below.
            migrationBuilder.CreateIndex(
                name: "IX_action_plans_source_survey_id",
                table: "action_plans",
                column: "source_survey_id");

            // ---------------------------------------------------------------------------------
            // Pre-flight for the three NULLABLE columns.
            //
            // Nulling a pointer that already points at nothing is not data loss: it is precisely
            // what ON DELETE SET NULL would have written had the constraint existed when the
            // survey was deleted. So the repair and the constraint say the same thing, and doing
            // the repair first means the constraint cannot fail on the customer's data.
            //
            // The counts are RAISEd rather than discarded because "it moved zero rows" is a
            // measurement worth having in the deploy log, and because a non-zero count is the
            // only evidence that will ever exist that a survey was deleted out from under a plan
            // or an insight.
            //
            // surveys."Id" is quoted PascalCase -- every table's primary key in this schema is,
            // because the EF configurations set HasColumnName on every property except Id.
            // Unquoted `id` fails with 42703.
            // ---------------------------------------------------------------------------------
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    plans     bigint;
                    ai        bigint;
                    analytics bigint;
                BEGIN
                    UPDATE action_plans a SET source_survey_id = NULL
                    WHERE a.source_survey_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = a.source_survey_id);
                    GET DIAGNOSTICS plans = ROW_COUNT;

                    UPDATE ai_insights i SET survey_id = NULL
                    WHERE i.survey_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = i.survey_id);
                    GET DIAGNOSTICS ai = ROW_COUNT;

                    UPDATE analytics_insights i SET survey_id = NULL
                    WHERE i.survey_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = i.survey_id);
                    GET DIAGNOSTICS analytics = ROW_COUNT;

                    RAISE NOTICE '#168 orphan repair: action_plans.source_survey_id=%, ai_insights.survey_id=%, analytics_insights.survey_id=% row(s) set to NULL.',
                        plans, ai, analytics;
                END $$;
                """);

            // action_plans.source_survey_id -- SET NULL.
            //
            // The column is provenance ("this plan came out of that survey") and nothing reads it
            // back: SourceSurveyId appears in CreateActionPlanRequest (ActionPlanDtos.cs:45) and
            // in neither ActionPlanListItem nor ActionPlanDetail. Losing the provenance is a far
            // smaller loss than losing the plan, which owns objectives, KPIs and progress updates
            // that all cascade from it -- so Cascade is out. Restrict is out because it converts a
            // working DELETE /surveys/{id} into a 500 for any survey somebody once linked a plan
            // to. SET NULL is also what the identically-named, identically-meaning
            // survey_templates.source_survey_id has done since it shipped, and matching a sibling
            // is how this schema avoids the survey_department_targets / microclimate_department_
            // targets split where the same relationship got two opposite behaviours.
            migrationBuilder.AddForeignKey(
                name: "FK_action_plans_surveys_source_survey_id",
                table: "action_plans",
                column: "source_survey_id",
                principalTable: "surveys",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // ai_insights.survey_id -- SET NULL.
            //
            // Cascade would delete a human's sign-off. An acknowledged insight carries
            // acknowledged_by / acknowledged_at, and AIInsightEndpoints.AcknowledgeAsync (line 182)
            // goes out of its way to keep the FIRST acknowledgement rather than the last, because
            // that row is who accepted the finding. Deleting the survey the finding came from
            // must not erase who accepted it. Restrict is out for the same reason as above.
            // Nulling the column reclassifies nothing: `grep -rn "SurveyId ==" src/` returns three
            // hits, all in DemographicSnapshotEndpoints, so no read path anywhere gives a NULL
            // survey_id on an insight a second meaning.
            migrationBuilder.AddForeignKey(
                name: "FK_ai_insights_surveys_survey_id",
                table: "ai_insights",
                column: "survey_id",
                principalTable: "surveys",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // analytics_insights.survey_id -- SET NULL, kept deliberately identical to ai_insights.
            //
            // The two tables are written by sibling endpoints with the same insert-time survey
            // check, so giving them different delete behaviour would be a difference nobody could
            // later justify. It does keep rows that own children (analytics_metric_data,
            // analytics_time_series) and whose subject is gone; that is stale, not wrong, and the
            // is_current flag already exists to say so.
            migrationBuilder.AddForeignKey(
                name: "FK_analytics_insights_surveys_survey_id",
                table: "analytics_insights",
                column: "survey_id",
                principalTable: "surveys",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // ---------------------------------------------------------------------------------
            // demographic_snapshots.survey_id -- CASCADE, and NOT VALID unless production is clean.
            //
            // Why CASCADE: the column is NOT NULL, so SET NULL is not available at all, and
            // Restrict would break DELETE /surveys/{id} the moment a survey has a snapshot. A
            // snapshot is defined by its survey -- keyed (survey_id, version) unique, listed and
            // diffed by survey_id -- so one whose survey is gone has no version sequence and no
            // route back through the API.
            //
            // What CASCADE costs, said here rather than discovered later: snapshot_id on
            // demographic_snapshot_entries and demographic_snapshot_changes is a required FK on
            // EF's default Cascade, so this reaches per-user demographic rows that
            // SubjectErasure.cs:238 classifies as RETAINED under a subject erasure request.
            //
            // Why NOT VALID rather than a repair: the repair for a NOT NULL column is a DELETE,
            // and this migration will not silently delete production rows holding personal data.
            // NOT VALID enforces the constraint on every INSERT and UPDATE from this moment on --
            // the integrity gap is closed either way -- and defers only the check of rows that are
            // already there. When there are none, which is what is expected, the constraint is
            // VALIDATEd in the same statement and is then indistinguishable from an ordinary FK.
            // When there are some, the deploy still succeeds, the count is in the log, and a
            // person decides what those rows were.
            // ---------------------------------------------------------------------------------
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    orphans bigint;
                BEGIN
                    SELECT count(*) INTO orphans
                    FROM demographic_snapshots d
                    WHERE NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = d.survey_id);

                    ALTER TABLE demographic_snapshots
                        ADD CONSTRAINT "FK_demographic_snapshots_surveys_survey_id"
                        FOREIGN KEY (survey_id) REFERENCES surveys ("Id")
                        ON DELETE CASCADE NOT VALID;

                    IF orphans = 0 THEN
                        ALTER TABLE demographic_snapshots
                            VALIDATE CONSTRAINT "FK_demographic_snapshots_surveys_survey_id";
                        RAISE NOTICE '#168: demographic_snapshots.survey_id -- 0 orphans, constraint added and VALIDATED.';
                    ELSE
                        RAISE WARNING '#168: demographic_snapshots.survey_id -- % orphaned row(s) predate this constraint and were LEFT IN PLACE. New and updated rows are enforced. Decide what those rows are, then run: ALTER TABLE demographic_snapshots VALIDATE CONSTRAINT "FK_demographic_snapshots_surveys_survey_id";', orphans;
                    END IF;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Dropping the constraints does not restore the survey ids the Up() repair nulled --
            // it cannot, the surveys they named do not exist. Down is a route back to the old
            // schema, not to the old data.
            migrationBuilder.DropForeignKey(
                name: "FK_action_plans_surveys_source_survey_id",
                table: "action_plans");

            migrationBuilder.DropForeignKey(
                name: "FK_ai_insights_surveys_survey_id",
                table: "ai_insights");

            migrationBuilder.DropForeignKey(
                name: "FK_analytics_insights_surveys_survey_id",
                table: "analytics_insights");

            migrationBuilder.DropForeignKey(
                name: "FK_demographic_snapshots_surveys_survey_id",
                table: "demographic_snapshots");

            migrationBuilder.DropIndex(
                name: "IX_action_plans_source_survey_id",
                table: "action_plans");
        }
    }
}
