
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
    }
}
