# Troubleshooting: Linux Firmware & ROCm

## 🚨 CRITICAL WARNING: linux-firmware-20251125

**Date:** 2026-01-08

AMD pushed an update to `linux-firmware` (included in version `20251125`) that critically breaks ROCm functionality on Strix Halo systems. While this update has been recalled, many distributions (including Fedora) have not picked it up.

If you are on this firmware version, you will likely experience **instability, crashes, or arbitrary failures** with ROCm workloads.

### How to check your version

```bash
rpm -qa | grep linux-firmware
```

If you see `linux-firmware-20251125` or similar, you **must downgrade**.

---

## Downgrade Instructions (Fedora)

The recommended stable version is `20251111`.

### Fedora 43

```bash
mkdir -p ~/linux-firmware-downgrade
cd ~/linux-firmware-downgrade

wget -r -np -nd -A '*.rpm' https://kojipkgs.fedoraproject.org/packages/linux-firmware/20251111/1.fc43/noarch/

sudo dnf downgrade ./*.rpm
sudo dracut -f
```

### Fedora 42

```bash
mkdir -p ~/linux-firmware-downgrade
cd ~/linux-firmware-downgrade

wget -r -np -nd -A '*.rpm' https://kojipkgs.fedoraproject.org/packages/linux-firmware/20251111/1.fc42/noarch/

sudo dnf downgrade ./*.rpm
sudo dracut -f
```

---

## Important: Kernel & Initramfs

**Crucially, `dracut -f` MUST be run with the kernel you intend to boot.** 

By default, `dracut -f` regenerates the initramfs for the *currently running* kernel. If you are not currently running the kernel you intend to use (e.g. you just installed it but haven't rebooted, or are booting into an older one), you must specify the version explicitly.

All tests have been validated with kernel: **`6.18.4-200.fc43.x86_64`**

To regenerate for a specific kernel (e.g. the tested one):

```bash
sudo dracut -f --kver 6.18.4-200.fc43.x86_64
```

Finally, **reboot** your system:

```bash
shutdown -r now
```

---

## Credits & References

Huge thanks to the **Strix Halo Home Lab** Discord community for identifying this regression and testing the fixes.

Specific thanks to:
- **lorphos**
- **kazak**

Relevant discussion threads:
- [Discord Thread 1](https://discord.com/channels/1384139280020148365/1455307501472976979/threads/1458579104315080779)
- [Discord Thread 2](https://discord.com/channels/1384139280020148365/1458512705093763387)
