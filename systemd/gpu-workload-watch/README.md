# GPU workload watcher

This systemd service manages cooling and the TuneD power profile on a Framework Desktop running GPU inference workloads.

## Behavior

- Detects `llama-*`, `ds4-*`, `hipfire`, and vLLM executables, process names, and Python entry points. Idle containers whose names contain these strings do not trigger the watcher.
- Selects the TuneD `accelerator-performance` profile as soon as a matching process starts, even while the GPU is idle.
- Selects the TuneD `balanced` profile when no matching process remains.
- Sets the fans to 100% after AMDGPU utilization is at least 20% for two seconds.
- Restores automatic fan control after utilization remains below 10% for 30 seconds, or immediately when the workload exits.
- Restores automatic fans and the `balanced` profile when the service stops.

The utilization delay and hysteresis prevent fan changes during short GPU bursts or pauses.

`balanced` is the general-purpose TuneD baseline and the profile recommended on the tested Framework Desktop. It is not identical to disabling TuneD: with TuneD disabled, the operating system's native defaults remain in control and no TuneD profile is applied.

## Requirements

- A Framework system whose Embedded Controller supports `ectool fanduty 100` and `ectool autofanctrl`.
- An AMD GPU exposing `/sys/class/drm/card*/device/gpu_busy_percent`.
- systemd and Bash 4 or newer.
- `ectool` available in `PATH`.
- TuneD with both the `accelerator-performance` and `balanced` profiles.

Check the commands before installation:

```bash
command -v ectool
command -v tuned-adm
sudo ectool pwmgetfanrpm all
tuned-adm list
```

### Fedora

TuneD is an official Fedora package. `fw-ectool` is available from the third-party `rowanfr/fw-ectool` COPR used by this project:

```bash
sudo dnf install tuned
sudo dnf copr enable rowanfr/fw-ectool
sudo dnf install fw-ectool
sudo systemctl enable --now tuned.service
```

Review the COPR before enabling it. Its packages are not part of Fedora.

### Ubuntu and Debian

Install TuneD from the distribution repository:

```bash
sudo apt update
sudo apt install tuned
sudo systemctl enable --now tuned.service
```

On Ubuntu, enable the Universe repository first if `apt` cannot find `tuned`.

Ubuntu and Debian do not currently provide the Framework `fw-ectool` package used here. Install a trusted `ectool` build separately and ensure `command -v ectool` succeeds. The source used by the Fedora package is [DHowett/framework-ec](https://github.com/DHowett/framework-ec); its `util/ectool` utility communicates with the Framework Embedded Controller.

## Install

From this directory:

```bash
sudo ./install.sh
```

The installer checks the required commands, TuneD profiles, and AMDGPU utilization counter before enabling the service.

Check its state and logs:

```bash
systemctl status gpu-workload-watch.service
journalctl -u gpu-workload-watch.service -f
```

## Remove

```bash
sudo systemctl disable --now gpu-workload-watch.service
sudo rm -f /etc/systemd/system/gpu-workload-watch.service /usr/local/sbin/gpu-workload-watch
sudo systemctl daemon-reload
sudo ectool autofanctrl
sudo tuned-adm profile balanced
```

## Files

- `gpu-workload-watch`: workload detection and fan/profile controller.
- `gpu-workload-watch.service`: systemd unit.
- `install.sh`: dependency check and installer.
