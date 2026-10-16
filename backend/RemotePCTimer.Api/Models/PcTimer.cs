
namespace RemotePCTimer.Api.Models;

public class PcTimer
{
    public int Id { get; set; } = 1;

    public bool IsActive { get; set; }

    public DateTime? EndsAtUtc { get; set; }

    public string Status { get; set; } = "Idle";

    public long Version { get; set; }

    public DateTime UpdatedAtUtc { get; set; } =
        DateTime.UtcNow;
}
