using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

public class ClimateProjectDbContext(DbContextOptions<ClimateProjectDbContext> options)
    : DbContext(options)
{
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
