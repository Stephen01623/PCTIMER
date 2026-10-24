using Microsoft.EntityFrameworkCore;
using RemotePCTimer.Api.Models;

namespace RemotePCTimer.Api.Data;

public class TimerDbContext : DbContext
{
    public TimerDbContext(DbContextOptions<TimerDbContext> options)
        : base(options)
    {
    }

    public DbSet<PcTimer> PcTimers => Set<PcTimer>();

    public DbSet<Voucher> Vouchers => Set<Voucher>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<PcTimer>(entity =>
        {
            entity.ToTable("pc_timers");

            entity.HasKey(timer => timer.Id);

            entity.Property(timer => timer.Id)
                .ValueGeneratedNever();

            entity.Property(timer => timer.Status)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(timer => timer.Version)
                .IsConcurrencyToken();

            entity.Property(timer => timer.UpdatedAtUtc)
                .IsRequired();
        });

        modelBuilder.Entity<Voucher>(entity =>
        {
            entity.ToTable("vouchers");

            entity.HasKey(voucher => voucher.Id);

            entity.Property(voucher => voucher.CodeHash)
                .HasMaxLength(64)
                .IsRequired();

            entity.HasIndex(voucher => voucher.CodeHash)
                .IsUnique();

            entity.Property(voucher => voucher.DurationMinutes)
                .IsRequired();

            entity.Property(voucher => voucher.Status)
                .HasMaxLength(20)
                .IsRequired();

            entity.Property(voucher => voucher.CreatedAtUtc)
                .IsRequired();

            entity.Property(voucher => voucher.RedeemedByDeviceId)
                .HasMaxLength(100);

            entity.ToTable(table =>
                table.HasCheckConstraint(
                    "CK_vouchers_duration",
                    "\"DurationMinutes\" IN (30, 60, 120)"));

            entity.ToTable(table =>
                table.HasCheckConstraint(
                    "CK_vouchers_status",
                    "\"Status\" IN ('Available', 'Redeemed', 'Revoked')"));
        });
    }
}