using Microsoft.AspNetCore.Mvc;
using RemotePCTimer.Api.DTOs;
using RemotePCTimer.Api.Services;

namespace RemotePCTimer.Api.Controllers;

[ApiController]
[Route("api/desktop/vouchers")]
public class DesktopVouchersController : ControllerBase
{
    private readonly IVoucherService _voucherService;
    private readonly IConfiguration _configuration;

    public DesktopVouchersController(
        IVoucherService voucherService,
        IConfiguration configuration)
    {
        _voucherService = voucherService;
        _configuration = configuration;
    }

    private bool IsAuthorized()
    {
        var expectedKey =
            _configuration["TimerSecurity:DesktopApiKey"];

        return !string.IsNullOrWhiteSpace(expectedKey)
            && Request.Headers.TryGetValue(
                "X-Device-Key",
                out var suppliedKey)
            && string.Equals(
                suppliedKey.ToString(),
                expectedKey,
                StringComparison.Ordinal);
    }

    [HttpPost("redeem")]
    public async Task<ActionResult<RedeemVoucherResponse>> Redeem(
        [FromBody] RedeemVoucherRequest request,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorized())
        {
            return Unauthorized(new
            {
                message = "Invalid desktop device key."
            });
        }

        var result = await _voucherService.RedeemAsync(
            request.Code,
            request.DeviceId,
            cancellationToken);

        if (!result.Success)
        {
            return BadRequest(new
            {
                message = result.Message
            });
        }

        return Ok(result.Data);
    }
}