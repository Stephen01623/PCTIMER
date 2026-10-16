
using RemotePCTimer.Api.DTOs;

namespace RemotePCTimer.Api.Services;

public interface ITimerService
{
    Task<TimerResponse> GetTimerAsync(
        CancellationToken cancellationToken = default);

    Task<TimerResponse> SetTimerAsync(
        int durationMinutes,
        CancellationToken cancellationToken = default);

    Task<ShutdownResponse> RequestShutdownAsync(
        CancellationToken cancellationToken = default);
}
