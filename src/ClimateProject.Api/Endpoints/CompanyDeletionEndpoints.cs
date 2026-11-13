using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Deleting a company that nobody has answered anything in (ruled 2026-11-08,
/// <c>docs/decisions/operators-reopen-exclude-delete.md</c>).
/// </summary>
/// <remarks>
/// <para><b>What it is for.</b> A company created by mistake, a rehearsal's company once its test
/// responses are gone, a client that never ran a survey. Until this, every one of those was a
/// 20 KB SQL script run by a developer (<c>delete-test-companies.sql</c>).</para>
///
/// <para><b>The rule is the survey rule, one level up.</b> <c>DELETE /surveys/{id}</c> refuses a
/// survey with responses (<c>survey_delete_has_responses</c>), because the answers cascade with it.
/// A company is refused for the same reason: any response -- counted or excluded -- any
/// microclimate that took an answer, or any link participation. A company that holds a super
/// admin is refused too: deleting it would delete a TIMS operator's account with it.</para>
///
/// <para><b>Why the deletion is spelled out table by table.</b> Thirty-odd foreign keys meet here,
/// and nine of them are RESTRICT edges that a single <c>DELETE FROM companies</c> trips over in the
/// middle of its own cascade (surveys -&gt; questions cascades while survey_versions.created_by -&gt;
/// users still holds; departments and categories reference their own parents). So the rows go
/// leaves first, self-references are cleared before their tables, and the company row goes last.
/// One transaction: anything still referenced elsewhere -- a person of this company who authored
/// something in another tenant -- raises, rolls everything back, and is answered 409.</para>
///
/// <para><b>Company-owned templates are deleted, not orphaned.</b> <c>survey_templates</c>,
/// <c>question_library_items</c> and six more point at their company with SET NULL, and a null
/// company means GLOBAL. Left to the cascade, a client's private questionnaire would become
/// visible to every tenant the moment its company went. Each is deleted explicitly first.</para>
///
/// <para><b>The audit trail is untouched.</b> <c>audit_logs</c> has no foreign keys since the
/// same migration, so its rows -- this deletion's own row, filed under the deleted company's id,
/// included -- outlive the company exactly as written.</para>
/// </remarks>
public static class CompanyDeletionEndpoints
{
    public static void MapCompanyDeletionEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/companies").RequireAuthorization();
        group.MapGet("/{id:guid}/deletion", AssessAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);
    }

    private static async Task<IResult> AssessAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (principal.GetCurrentUser().Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var assessment = await AssessCompanyAsync(db, id, cancellationToken);
        return assessment is null ? CompanyNotFound() : Results.Ok(assessment);
    }

    private static async Task<IResult> DeleteAsync(
        Guid id,
        [FromBody] DeleteCompanyRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var assessment = await AssessCompanyAsync(db, id, cancellationToken);
        if (assessment is null)
        {
            return CompanyNotFound();
        }

        // Filed under the company being deleted: audit_logs keeps no foreign key, so this row
        // stays, beside the company's own history, after the company is gone.
        if (await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken) is { } actorId)
        {
            audit.AttributeTo(actorId, id);
        }

        if (!string.Equals(request.ConfirmName?.Trim(), assessment.Name.Trim(), StringComparison.Ordinal))
        {
            return Results.Json(
                new { message = "Type the company's name exactly as it is written to confirm.", code = AdminRefusals.CompanyNameMismatch },
                statusCode: 400);
        }

        if (assessment.Responses > 0 || assessment.AnsweredMicroclimates > 0 || assessment.LinkParticipations > 0)
        {
            return Results.Json(
                new
                {
                    message = "This company holds answers, so deleting it would delete them. Only a company nobody has answered anything in can be deleted.",
                    code = AdminRefusals.CompanyHasResponses,
                    assessment.Responses,
                    assessment.AnsweredMicroclimates,
                    assessment.LinkParticipations,
                },
                statusCode: 409);
        }

        if (assessment.SuperAdmins > 0)
        {
            return Results.Json(
                new
                {
                    message = "A super administrator belongs to this company; deleting it would delete their account. Move or remove them first.",
                    code = AdminRefusals.CompanyHoldsSuperAdmins,
                    assessment.SuperAdmins,
                },
                statusCode: 409);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await DeleteEverythingOfAsync(db, id, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (PostgresException failure) when (failure.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            await transaction.RollbackAsync(cancellationToken);
            // The constraint, never the message: Npgsql's message carries row values.
            loggerFactory.CreateLogger(typeof(CompanyDeletionEndpoints)).LogWarning(
                "Company deletion rolled back: still referenced through {Constraint} on {Table}",
                failure.ConstraintName,
                failure.TableName);
            return Results.Json(
                new
                {
                    message = "Something outside this company still points at it or at one of its people, so nothing was deleted.",
                    code = AdminRefusals.CompanyPeopleReferenced,
                    constraint = failure.ConstraintName,
                },
                statusCode: 409);
        }

        // Recorded only once it happened: a refused or rolled-back deletion leaves a row with no
        // changes, which is what it did.
        audit.RecordChange("name", assessment.Name, null);
        audit.RecordChange("domain", assessment.Domain, null);
        audit.RecordChange("people", assessment.People.ToString(System.Globalization.CultureInfo.InvariantCulture), "0");
        audit.RecordChange("surveys", assessment.Surveys.ToString(System.Globalization.CultureInfo.InvariantCulture), "0");

        return Results.NoContent();
    }

    /// <summary>
    /// The deletion, in dependency order. Every statement is scoped by <c>company_id</c> (or the
    /// company's own id), so nothing of another tenant is touched; a row elsewhere that still
    /// references something here makes a statement raise and the caller's transaction roll back.
    /// </summary>
    internal static async Task DeleteEverythingOfAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        // People reference each other as managers (RESTRICT): cleared before anybody goes.
        await db.Database.ExecuteSqlAsync($"UPDATE users SET manager_id = NULL WHERE company_id = {id}", cancellationToken);

        // Surveys first: they cascade to questions, versions, invitations, keys, targets,
        // distributions, participations, snapshots and the per-survey history -- all of which
        // hold RESTRICT edges into users that would otherwise block the people below.
        await db.Database.ExecuteSqlAsync($"DELETE FROM surveys WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM microclimates WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM action_plans WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM reports WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM demographic_snapshots WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM user_invitations WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM survey_invitations WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM microclimate_invitations WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM notifications WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM survey_drafts WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM survey_participations WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM ai_insights WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM analytics_insights WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM company_logos WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM company_service_licenses WHERE company_id = {id}", cancellationToken);

        // Company-owned content whose company key is SET NULL: deleted, never let fall to global.
        await db.Database.ExecuteSqlAsync($"UPDATE question_library_items SET previous_version_id = NULL WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM question_library_items WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"UPDATE question_categories SET parent_category_id = NULL WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM question_categories WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"UPDATE question_bank_items SET parent_question_bank_item_id = NULL WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM question_bank_items WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM survey_templates WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM microclimate_templates WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM action_plan_templates WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM notification_templates WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"UPDATE benchmarks SET prior_period_benchmark_id = NULL WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM benchmarks WHERE company_id = {id}", cancellationToken);

        // The org structure, then the people, then the company.
        await db.Database.ExecuteSqlAsync($"UPDATE departments SET parent_department_id = NULL WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM departments WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM demographic_fields WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM users WHERE company_id = {id}", cancellationToken);
        await db.Database.ExecuteSqlAsync($"DELETE FROM companies WHERE \"Id\" = {id}", cancellationToken);
    }

    /// <summary>What deleting the company would take, and what refuses it. Null when it does not exist.</summary>
    internal static async Task<CompanyDeletionAssessment?> AssessCompanyAsync(
        ClimateProjectDbContext db,
        Guid id,
        CancellationToken cancellationToken)
    {
        var company = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => new { c.Name, Domain = c.EmailDomain })
            .FirstOrDefaultAsync(cancellationToken);
        if (company is null)
        {
            return null;
        }

        // Excluded responses count here: they are stored answers, and deleting the company would
        // delete them.
        var responses = await db.Responses
            .IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded)
            .CountAsync(r => r.CompanyId == id, cancellationToken);
        var answeredMicroclimates = await db.Microclimates.CountAsync(m => m.CompanyId == id && m.ResponseCount > 0, cancellationToken);
        var linkParticipations = await db.SurveyParticipations.CountAsync(p => p.CompanyId == id, cancellationToken);
        var superAdmins = await db.Users.CountAsync(u => u.CompanyId == id && u.Role == Roles.SuperAdmin, cancellationToken);
        var people = await db.Users.CountAsync(u => u.CompanyId == id, cancellationToken);
        var surveys = await db.Surveys.CountAsync(s => s.CompanyId == id, cancellationToken);
        var departments = await db.Departments.CountAsync(d => d.CompanyId == id, cancellationToken);

        return new CompanyDeletionAssessment(
            id,
            company.Name,
            company.Domain,
            Deletable: responses == 0 && answeredMicroclimates == 0 && linkParticipations == 0 && superAdmins == 0,
            responses,
            answeredMicroclimates,
            linkParticipations,
            superAdmins,
            people,
            surveys,
            departments);
    }

    private static IResult CompanyNotFound() => Results.Json(new { message = "Company not found" }, statusCode: 404);
}

/// <summary>Body of <c>DELETE /admin/companies/{id}</c>: the company's name, typed, as the confirmation.</summary>
public sealed record DeleteCompanyRequest(string? ConfirmName);

/// <summary>
/// <c>GET /admin/companies/{id}/deletion</c>: what a deletion would remove, and the counts that
/// refuse it. <see cref="Deletable"/> is false while any of the first four is above zero.
/// </summary>
public sealed record CompanyDeletionAssessment(
    Guid Id,
    string Name,
    string? Domain,
    bool Deletable,
    int Responses,
    int AnsweredMicroclimates,
    int LinkParticipations,
    int SuperAdmins,
    int People,
    int Surveys,
    int Departments);
