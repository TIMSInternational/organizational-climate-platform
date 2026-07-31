using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(u => u.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        builder.Property(u => u.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(u => u.PasswordHash).HasColumnName("password_hash");
        builder.Property(u => u.Role).HasColumnName("role").HasMaxLength(32).IsRequired();
        builder.Property(u => u.NodoId).HasColumnName("nodo_id").HasMaxLength(64);
        builder.Property(u => u.IsActive).HasColumnName("is_active").IsRequired();
        builder.Property(u => u.LastLoginAt).HasColumnName("last_login_at");
        builder.Property(u => u.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(u => u.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.HasIndex(u => u.Email).IsUnique();
        builder.HasOne<Company>().WithMany().HasForeignKey(u => u.CompanyId);
    }
}
