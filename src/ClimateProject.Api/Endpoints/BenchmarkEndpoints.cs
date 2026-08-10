using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
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

    // Read access: a CompanyAdmin may view global benchmarks (CompanyId == null, visible to
    // every tenant for comparison purposes -- see ListAsync) as well as their own company's.
    private static bool CanReadBenchmark(CurrentUser currentUser, Guid? benchmarkCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return benchmarkCompanyId is null || currentUser.CompanyId == benchmarkCompanyId.Value.ToString();
    }

    // Write access: a CompanyAdmin may only create/update/add-metrics-to benchmarks scoped to
    // their OWN company. Global benchmarks (CompanyId == null) are visible to every tenant
    // (CanReadBenchmark), so allowing CompanyAdmin writes there would let any tenant tamper
    // with data every other tenant sees -- global benchmarks are SuperAdmin-only to write.
    private static bool CanWriteBenchmark(CurrentUser currentUser, Guid? benchmarkCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return benchmarkCompanyId is not null && currentUser.CompanyId == benchmarkCompanyId.Value.ToString();
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
        if (!CanWriteBenchmark(currentUser, request.CompanyId)) return Results.Forbid();

        var name = request.Name?.Trim();
        var description = request.Description?.Trim();
        var type = request.Type?.Trim();
        var category = request.Category?.Trim();
        var source = request.Source?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(description)
            || string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(category) || string.IsNullOrWhiteSpace(source))
        {
            return Results.Json(new { message = "Name, Description, Type, Category, and Source are required" }, statusCode: 400);
        }

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
            Name = name,
            Description = description,
            Type = type,
            Category = category,
            Source = source,
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
        if (!CanReadBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(Guid id, UpdateBenchmarkRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanWriteBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var name = request.Name?.Trim();
        var description = request.Description?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(description))
        {
            return Results.Json(new { message = "Name and Description are required" }, statusCode: 400);
        }

        benchmark.Name = name;
        benchmark.Description = description;
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
        if (!CanWriteBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

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

    // PersonaExternalId first, then Id -- see ActingUserResolver for why the order is
    // load-bearing. The Guid.Empty fallback for an unresolvable caller is pre-existing
    // behaviour, deliberately left alone by #285: `benchmarks.created_by` is a required FK
    // to `users` (BenchmarkConfiguration), so it fails the insert rather than filing the row
    // against a real account.
    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
        => await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken) ?? Guid.Empty;

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
