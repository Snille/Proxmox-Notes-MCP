# <i class="fa fa-linux"></i> Seerr Server
| | |
| - | - |
| <img title="Seerr Server" src="https://icons.example.com/proxmox/icons/blue/100x100/overseerr01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> Request manager for movies and series (requests.example.com).<br>Replaces Overseerr. Sends requests to Sonarr02 and Radarr02, reads Plex. |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-16 with the community script <b>seerr</b> (Seerr 3.5.0, built from source with Node 22 + pnpm).<br>Built on pve-test, moved to pve-prod with backup and restore. Replaces Overseerr01; its config and database were migrated.<br>Unprivileged CT, no media mounts. Config /opt/seerr/config (settings.json, db/db.sqlite3), port in /etc/seerr/seerr.conf (5055).<br>Update: run <b>update</b> as root in the CT (rebuilds from source; needs the 4 GB RAM).
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-16 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** Weekly (Sun) @ 01:00 |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.29 |
|  | **MAC:** bc:24:11:00:00:09 |
|  | **DHCP:** No |
| <i class="fa fa-cogs"></i> **Services:** | <a href="https://requests.example.com" target="_blank" style="text-decoration: none; color: #00f000;">requests.example.com</a> |
|  | <a href="http://192.0.2.29:5055" target="_blank" style="text-decoration: none; color: #00f000;">Seerr (LAN)</a> |
|  | <a href="https://192.0.2.29:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
