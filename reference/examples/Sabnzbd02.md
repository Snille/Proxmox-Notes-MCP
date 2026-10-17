# <i class="fa fa-linux"></i> SABnzbd Server
| | |
| - | - |
| <img title="SABnzbd Server" src="https://icons.example.com/proxmox/icons/blue/100x100/sabnzbd01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> Usenet downloader for Sonarr02, Radarr02 and Lidarr02. |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-16 with the community script <b>sabnzbd</b> (SABnzbd 5.1.3, par2cmdline-turbo 1.5.0).<br>Built on pve-test, moved to pve-prod with backup and restore. Replaces Sabnzbd01.<br>Privileged CT with /mnt/data. SABnzbd runs as sofa:admins (1020:1001), UMask 0002, config /var/lib/sabnzbd/sabnzbd.ini, port 8181 (drop-in sabnzbd.service.d/10-user.conf overrides the script's root/port 7777).<br>Python venv /opt/sabnzbd/venv uses Debian's /usr/bin/python3.13 (system OpenSSL, so sabctools can link it; uv's Python under /root is not readable for sofa and has static OpenSSL).<br>Update: run <b>update</b> as root in the CT. Each update keeps a copy in /opt/sabnzbd_backup_*; remove old ones now and then.
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-16 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** Weekly (Sun) @ 01:00 |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.31 |
|  | **MAC:** bc:24:11:00:00:08 |
|  | **DHCP:** No |
| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.31:8181" target="_blank" style="text-decoration: none; color: #00f000;">SABnzbd</a> |
|  | <a href="https://192.0.2.31:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
