# <i class="fa fa-linux"></i> SuggestArr Server
| | |
| - | - |
| <img title="SuggestArr Server" src="https://icons.example.com/proxmox/icons/blue/100x100/default01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> Suggests movies and series from Plex watch history (TMDb) and requests them in Seerr01. |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-17 with the community script <b>suggestarr</b> (SuggestArr 2.16.1).<br>Built on pve-test, moved to pve-prod with backup and restore.<br>Unprivileged CT, no media mounts. Data /opt/suggestarr_data, settings /opt/suggestarr.env, service suggestarr (uvicorn, port 5000).<br>Configured by the owner in the web wizard: Plex 192.0.2.17, Seerr 192.0.2.29:5055, own TMDb key. Requests should need approval in Seerr.<br>Update: run <b>update</b> as root in the CT.
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-17 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** Weekly (Sun) @ 01:00 |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.46 |
|  | **MAC:** bc:24:11:00:00:0b |
|  | **DHCP:** No |
| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.46:5000" target="_blank" style="text-decoration: none; color: #00f000;">SuggestArr</a> |
|  | <a href="https://192.0.2.46:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
