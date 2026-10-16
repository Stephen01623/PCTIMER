
namespace RemotePCTimer.Api.DTOs;

public class TimerResponse
{
    public bool IsActive { get; set; }

    public DateTime? EndsAtUtc { get; set; }

    public string Status { get; set; } = "Idle";

    public long Version { get; set; }

    public DateTime ServerTimeUtc { get; set; }

    public long RemainingSeconds { get; set; }
}
