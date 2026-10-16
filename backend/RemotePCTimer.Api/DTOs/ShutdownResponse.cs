
namespace RemotePCTimer.Api.DTOs;

public class ShutdownResponse
{
    public bool Success { get; set; }

    public string Message { get; set; } = string.Empty;

    public TimerResponse? Timer { get; set; }
}
