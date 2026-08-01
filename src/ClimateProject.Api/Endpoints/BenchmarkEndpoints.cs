using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class BenchmarkEndpoints
{
    public static void MapBenchmarkEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/benchmarks").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPost("/{id:guid}/metrics", AddMetricAsync);
    }

    private static bool CanAccessBenchmark(CurrentUser currentUser, Guid? benchmarkCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (benchmarkCompanyId is null) return currentUser.Role == Roles.CompanyAdmin;
        return currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == benchmarkCompanyId.Value.ToString();
    }

    private static async Task<IResult> ListAsync(Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = db.Benchmarks.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var ownCompanyId = Guid.Parse(currentUser.CompanyId);
            query = query.Where(b => b.CompanyId == null || b.CompanyId == ownCompanyId);
        }
        else if (companyId.HasValue)
        {
            query = query.Where(b => b.CompanyId == companyId.Value);
        }

        var benchmarks = await query
            .OrderBy(b => b.Name)
            .Select(b => new BenchmarkListItem(b.Id, b.Name, b.Type, b.Category, b.CompanyId, b.IsActive, b.QualityScore))
            .ToListAsync(cancellationToken);

        return Results.Ok(benchmarks);
    }

    private static async Task<IResult> CreateAsync(CreateBenchmarkRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessBenchmark(currentUser, request.CompanyId)) return Results.Forbid();

        if (request.PriorPeriodBenchmarkId.HasValue)
        {
            var priorExists = await db.Benchmarks.AnyAsync(b => b.Id == request.PriorPeriodBenchmarkId.Value, cancellationToken);
            if (!priorExists) return Results.Json(new { message = "PriorPeriodBenchmarkId does not reference an existing benchmark" }, statusCode: 400);
        }

        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var benchmark = new Benchmark
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Description = request.Description,
            Type = request.Type,
            Category = request.Category,
            Source = request.Source,
            Industry = request.Industry,
            CompanySize = request.CompanySize,
            Region = request.Region,
            CreatedBy = createdBy,
            CompanyId = request.CompanyId,
            IsActive = true,
            ValidationStatus = "pending",
            QualityScore = 0,
            PriorPeriodBenchmarkId = request.PriorPeriodBenchmarkId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Benchmarks.Add(benchmark);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, benchmark.Id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanAccessBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(Guid id, CreateBenchmarkRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanAccessBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        benchmark.Name = request.Name;
        benchmark.Description = request.Description;
        benchmark.Industry = request.Industry;
        benchmark.CompanySize = request.CompanySize;
        benchmark.Region = request.Region;
        benchmark.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> AddMetricAsync(Guid id, AddBenchmarkMetricRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanAccessBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var metric = new BenchmarkMetric
        {
            Id = Guid.NewGuid(),
            BenchmarkId = id,
            MetricName = request.MetricName,
            Value = request.Value,
            Unit = request.Unit,
            Percentile = request.Percentile,
            SampleSize = request.SampleSize,
        };
        db.BenchmarkMetrics.Add(metric);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null) return byId.Id;
        }
        var byExternalId = await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id ?? Guid.Empty;
    }

    private static async Task<BenchmarkDetail> LoadDetailAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var b = await db.Benchmarks.FirstAsync(x => x.Id == id, cancellationToken);
        var metrics = await db.BenchmarkMetrics
            .Where(m => m.BenchmarkId == id)
            .Select(m => new BenchmarkMetricDto(m.Id, m.MetricName, m.Value, m.Unit, m.Percentile, m.SampleSize))
            .ToListAsync(cancellationToken);

        return new BenchmarkDetail(
            b.Id, b.Name, b.Description, b.Type, b.Category, b.Source, b.Industry, b.CompanySize,
            b.Region, b.CompanyId, b.IsActive, b.ValidationStatus, b.QualityScore, b.PriorPeriodBenchmarkId, metrics);
    }
}
