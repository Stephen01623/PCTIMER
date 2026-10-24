using Microsoft.AspNetCore.Mvc;
using RemotePCTimer.Api.DTOs;
using RemotePCTimer.Api.Services;

namespace RemotePCTimer.Api.Controllers;

[ApiController]
[Route("api/admin/vouchers")]
public class AdminVouchersController : ControllerBase
{
    private readonly IVoucherService _voucherService;
    private readonly IConfiguration _configuration;

    public AdminVouchersController(
        IVoucherService voucherService,
        IConfiguration configuration)
    {
        _voucherService = voucherService;
        _configuration = configuration;
    }

    private bool IsAuthorized()
    {
        var expectedKey =
            _configuration["TimerSecurity:AdminApiKey"];

        return !string.IsNullOrWhiteSpace(expectedKey)
            && Request.Headers.TryGetValue(
                "X-Admin-Key",
                out var suppliedKey)
            && string.Equals(
                suppliedKey.ToString(),
                expectedKey,
                StringComparison.Ordinal);
    }

    [HttpPost]
    public async Task<ActionResult<List<GeneratedVoucherResponse>>> Create(
        [FromBody] CreateVouchersRequest request,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized())
        {
            return Unauthorized(new
            {
                message = "Invalid admin API key."
            });
        }

        if (request.DurationMinutes is not (30 or 60 or 120))
        {
            return BadRequest(new
            {
                message = "Duration must be 30, 60, or 120 minutes."
            });
        }

        try
        {
            var vouchers = await _voucherService.CreateAsync(
                request.DurationMinutes,
                request.Quantity,
                cancellationToken);

            return Ok(vouchers);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet]
    public async Task<ActionResult<List<VoucherListItemResponse>>> GetAll(
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized())
        {
            return Unauthorized(new
            {
                message = "Invalid admin API key."
            });
        }

        var vouchers = await _voucherService.GetAllAsync(
            cancellationToken);

        return Ok(vouchers);
    }
}