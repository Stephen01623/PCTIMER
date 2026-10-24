using System.ComponentModel.DataAnnotations;

namespace RemotePCTimer.Api.DTOs;

public class CreateVouchersRequest
{
    [Range(30, 120)]
    public int DurationMinutes { get; set; }

    [Range(1, 100)]
    public int Quantity { get; set; } = 1;
}

public class GeneratedVoucherResponse
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public int DurationMinutes { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
}

public class VoucherListItemResponse
{
    public Guid Id { get; set; }
    public int DurationMinutes { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? RedeemedAtUtc { get; set; }
    public string? RedeemedByDeviceId { get; set; }
}

public class RedeemVoucherRequest
{
    [Required]
    [StringLength(40, MinimumLength = 8)]
    public string Code { get; set; } = string.Empty;

    [Required]
    [StringLength(100, MinimumLength = 1)]
    public string DeviceId { get; set; } = string.Empty;
}

public class RedeemVoucherResponse
{
    public string Message { get; set; } = string.Empty;
    public int DurationMinutes { get; set; }
    public DateTime RedeemedAtUtc { get; set; }
    public DateTime EndsAtUtc { get; set; }
}