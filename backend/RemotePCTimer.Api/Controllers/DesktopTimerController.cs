
using Microsoft.AspNetCore.Mvc;
using RemotePCTimer.Api.DTOs;
using RemotePCTimer.Api.Services;

namespace RemotePCTimer.Api.Controllers;

[ApiController]
[Route("api/desktop/timer")]
public class DesktopTimerController : ControllerBase
{
    private readonly ITimerService _timerService;
    private readonly IConfiguration _configuration;

    public DesktopTimerController(
        ITimerService timerService,
        IConfiguration configuration)
    {
        _timerService = timerService;
        _configuration = configuration;
    }

    [HttpGet]
    public async Task<ActionResult<TimerResponse>> GetTimer(
        CancellationToken cancellationToken)
    {
        var expectedKey = _configuration["TimerSecurity:DesktopApiKey"];

        if (string.IsNullOrWhiteSpace(expectedKey)
            || !Request.Headers.TryGetValue(
                "X-Device-Key", out var suppliedKey)
            || !string.Equals(
                suppliedKey.ToString(),
                expectedKey,
                StringComparison.Ordinal))
        {
            return Unauthorized(new
            {
                message = "Invalid desktop device key."
            });
        }

        var timer = await _timerService.GetTimerAsync(cancellationToken);

        return Ok(timer);
    }
}
