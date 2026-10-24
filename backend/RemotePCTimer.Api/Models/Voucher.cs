using System.ComponentModel.DataAnnotations;

namespace RemotePCTimer.Api.Models;

public class Voucher
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    [MaxLength(64)]
    public string CodeHash { get; set; } = string.Empty;

    public int DurationMinutes { get; set; }

    [Required]
    [MaxLength(20)]
    public string Status { get; set; } = "Available";

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime? RedeemedAtUtc { get; set; }

    [MaxLength(100)]
    public string? RedeemedByDeviceId { get; set; }
}   