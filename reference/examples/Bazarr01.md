# <i class="fa fa-linux"></i> Bazarr Server
| | |
| - | - |
| <img title="Bazarr Server" src="https://icons.example.com/proxmox/icons/blue/100x100/default01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> Subtitle manager for Sonarr02 and Radarr02.<br>Swedish first, English as fallback. |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-16 with the community script <b>bazarr</b> (Bazarr 1.6.2).<br>Built on pve-test, moved to pve-prod with backup and restore.<br>Privileged CT. Bazarr runs as sofa:admins (1020:1001), UMask 0002 (drop-in bazarr.service.d/10-user.conf).<br>Python venv /opt/bazarr/venv uses Python 3.12 in /opt/uv-python (the script's Python under /root is not readable for sofa). Package 7zip installed for archive extraction. The drop-in also makes the bundled ffmpeg/ffprobe executable at every start (ExecStartPre).<br>Providers: Embedded Subtitles, YIFY, Gestdown (OpenSubtitles.com and Subdl added by the owner).<br>Update: run <b>update</b> as root in the CT. If the update ever recreates the venv, rebuild it with UV_PYTHON_INSTALL_DIR=/opt/uv-python.
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-16 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** Weekly (Sun) @ 01:00 |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.30 |
|  | **MAC:** bc:24:11:00:00:02 |
|  | **DHCP:** No |
| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.30:6767" target="_blank" style="text-decoration: none; color: #00f000;">Bazarr</a> |
|  | <a href="https://192.0.2.30:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
