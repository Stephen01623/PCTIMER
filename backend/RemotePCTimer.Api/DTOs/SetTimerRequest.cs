
using System.ComponentModel.DataAnnotations;

namespace RemotePCTimer.Api.DTOs;

public class SetTimerRequest
{
    [Range(1, 1440)]
    public int DurationMinutes { get; set; }
}
