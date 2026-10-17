# <i class="fa fa-linux"></i> Sonarr Server
| | |
| - | - |
| <img title="Sonarr Server" src="https://icons.example.com/proxmox/icons/blue/100x100/sonarr01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> TV series manager.<br>Gets indexers from Prowlarr01, sends downloads to SABnzbd and the torrent client. |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-16 with the community script <b>sonarr</b> (Sonarr 4.0.20).<br>Built on pve-test, moved to pve-prod with backup and restore. Replaces Sonarr01.<br>Privileged CT with /mnt/data. Sonarr runs as sofa:admins (1020:1001), UMask 0002 (drop-in sonarr.service.d/10-user.conf).<br>Update: run <b>update</b> as root in the CT (Sonarr update mechanism is set to External).
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-16 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** Weekly (Sun) @ 01:00 |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.36 |
|  | **MAC:** bc:24:11:00:00:0a |
|  | **DHCP:** No |
| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.36:8989" target="_blank" style="text-decoration: none; color: #00f000;">Sonarr</a> |
|  | <a href="https://192.0.2.36:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
