
using Microsoft.AspNetCore.Mvc;
using RemotePCTimer.Api.DTOs;
using RemotePCTimer.Api.Services;

namespace RemotePCTimer.Api.Controllers;

[ApiController]
[Route("api/admin/timer")]
public class AdminTimerController : ControllerBase
{
    private readonly ITimerService _timerService;
    private readonly IConfiguration _configuration;

    public AdminTimerController(
        ITimerService timerService,
        IConfiguration configuration)
    {
        _timerService = timerService;
        _configuration = configuration;
    }

    private bool IsAuthorized()
    {
        var expectedKey = _configuration["TimerSecurity:AdminApiKey"];

        return !string.IsNullOrWhiteSpace(expectedKey)
            && Request.Headers.TryGetValue("X-Admin-Key", out var suppliedKey)
            && string.Equals(
                suppliedKey.ToString(),
                expectedKey,
                StringComparison.Ordinal);
    }

    [HttpGet]
    public async Task<ActionResult<TimerResponse>> GetTimer(
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized())
            return Unauthorized(new { message = "Invalid admin API key." });

        var timer = await _timerService.GetTimerAsync(cancellationToken);

        return Ok(timer);
    }

    [HttpPost("set")]
    public async Task<ActionResult<TimerResponse>> SetTimer(
        [FromBody] SetTimerRequest request,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized())
            return Unauthorized(new { message = "Invalid admin API key." });

        try
        {
            var timer = await _timerService.SetTimerAsync(
                request.DurationMinutes,
                cancellationToken);

            return Ok(timer);
        }
        catch (ArgumentOutOfRangeException)
        {
            return BadRequest(new
            {
                message = "Duration must be between 1 and 1440 minutes."
            });
        }
    }

    [HttpPost("shutdown-now")]
    public async Task<ActionResult<ShutdownResponse>> ShutdownNow(
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized())
            return Unauthorized(new { message = "Invalid admin API key." });

        var response = await _timerService.RequestShutdownAsync(
            cancellationToken);

        return Ok(response);
    }
}
