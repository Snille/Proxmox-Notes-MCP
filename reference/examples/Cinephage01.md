# <i class="fa fa-wrench"></i> Cinephage Test
| | |
| - | - |
| <img title="Cinephage Test" src="https://icons.example.com/proxmox/icons/blue/100x100/default01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> TEST ONLY on pve-test. All-in-one media manager (replaces Sonarr/Radarr/Prowlarr/Bazarr/Seerr).<br>Not connected to SABnzbd02 or qBittorrent01. |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-17 with the community script <b>cinephage</b> (Cinephage 0.17.0, Node 24, Camoufox headless browser).<br>Unprivileged CT, no media mounts. Data /opt/cinephage_data (.env with auth secret), service cinephage as root, port 3000.<br>Test rules: do not add download clients, do not enter the Usenet login. Stop the CT when the test is done.
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-17 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** None (test) |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.43 |
|  | **MAC:** bc:24:11:00:00:03 |
|  | **DHCP:** No |
| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.43:3000" target="_blank" style="text-decoration: none; color: #00f000;">Cinephage</a> |
|  | <a href="https://192.0.2.43:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
