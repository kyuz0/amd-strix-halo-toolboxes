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
# 1. Download the stable firmware packages
wget -m https://kojipkgs.fedoraproject.org/packages/linux-firmware/20251111/1.fc43/noarch/ -I /packages/linux-firmware/20251111/1.fc43/noarch/

# 2. Navigate to the download directory
cd kojipkgs.fedoraproject.org/packages/linux-firmware/20251111/1.fc43/noarch/

# 3. Downgrade
sudo dnf downgrade *.rpm
```

### Fedora 42

```bash
# 1. Download the stable firmware packages
wget -m https://kojipkgs.fedoraproject.org/packages/linux-firmware/20251111/1.fc42/noarch/ -I /packages/linux-firmware/20251111/1.fc42/noarch/

# 2. Navigate to the download directory
cd kojipkgs.fedoraproject.org/packages/linux-firmware/20251111/1.fc42/noarch/

# 3. Downgrade
sudo dnf downgrade *.rpm
```

---

## Kernel & Modules Check

After downgrading firmware, ensure your kernel and modules are consistent. You may want to reinstall/upgrade the kernel to ensure initramfs is rebuilt correctly or simply to match the tested configuration.

```bash
sudo dnf install kernel-6.18.3-200.fc43.x86_64 kernel-modules-extra-6.18.3-200.fc43.x86_64 kernel-tools-6.18.3-200.fc43.x86_64 --enablerepo=updates-testing
```
*(Adjust kernel version numbers as appropriate for your specific distribution state)*

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
