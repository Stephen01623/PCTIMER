
using Microsoft.EntityFrameworkCore;
using RemotePCTimer.Api.Data;
using RemotePCTimer.Api.DTOs;
using RemotePCTimer.Api.Models;

namespace RemotePCTimer.Api.Services;

public class TimerService : ITimerService
{
    private readonly TimerDbContext _dbContext;

    public TimerService(TimerDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<TimerResponse> GetTimerAsync(
        CancellationToken cancellationToken = default)
    {
        var timer = await GetOrCreateTimerAsync(cancellationToken);
        var now = DateTime.UtcNow;

        if (timer.IsActive &&
            timer.EndsAtUtc.HasValue &&
            timer.EndsAtUtc.Value <= now)
        {
            timer.IsActive = false;
            timer.Status = "ShutdownRequested";
            timer.Version++;
            timer.UpdatedAtUtc = now;

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return ToResponse(timer);
    }

    public async Task<TimerResponse> SetTimerAsync(
        int durationMinutes,
        CancellationToken cancellationToken = default)
    {
        if (durationMinutes < 1 || durationMinutes > 1440)
        {
            throw new ArgumentOutOfRangeException(
                nameof(durationMinutes),
                "Timer duration must be between 1 and 1440 minutes.");
        }

        var timer = await GetOrCreateTimerAsync(cancellationToken);
        var now = DateTime.UtcNow;

        timer.IsActive = true;
        timer.EndsAtUtc = now.AddMinutes(durationMinutes);
        timer.Status = "Active";
        timer.Version++;
        timer.UpdatedAtUtc = now;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ToResponse(timer);
    }

    public async Task<ShutdownResponse> RequestShutdownAsync(
        CancellationToken cancellationToken = default)
    {
        var timer = await GetOrCreateTimerAsync(cancellationToken);
        var now = DateTime.UtcNow;

        timer.IsActive = false;
        timer.EndsAtUtc = now;
        timer.Status = "ShutdownRequested";
        timer.Version++;
        timer.UpdatedAtUtc = now;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return new ShutdownResponse
        {
            Success = true,
            Message = "Shutdown request sent to the desktop application.",
            Timer = ToResponse(timer)
        };
    }

    private async Task<PcTimer> GetOrCreateTimerAsync(
        CancellationToken cancellationToken)
    {
        var timer = await _dbContext.PcTimers
            .SingleOrDefaultAsync(
                item => item.Id == 1,
                cancellationToken);

        if (timer is not null)
        {
            return timer;
        }

        timer = new PcTimer
        {
            Id = 1,
            IsActive = false,
            EndsAtUtc = null,
            Status = "Idle",
            Version = 1,
            UpdatedAtUtc = DateTime.UtcNow
        };

        _dbContext.PcTimers.Add(timer);

        await _dbContext.SaveChangesAsync(cancellationToken);

        return timer;
    }

    private static TimerResponse ToResponse(PcTimer timer)
    {
        var now = DateTime.UtcNow;

        var remainingSeconds =
            timer.IsActive && timer.EndsAtUtc.HasValue
                ? Math.Max(
                    0,
                    (long)Math.Ceiling(
                        (timer.EndsAtUtc.Value - now).TotalSeconds))
                : 0;

        return new TimerResponse
        {
            IsActive = timer.IsActive,
            EndsAtUtc = timer.EndsAtUtc,
            Status = timer.Status,
            Version = timer.Version,
            ServerTimeUtc = now,
            RemainingSeconds = remainingSeconds
        };
    }
}
