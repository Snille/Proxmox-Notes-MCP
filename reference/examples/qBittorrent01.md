# <i class="fa fa-linux"></i> qBittorrent Server
| | |
| - | - |
| <img title="qBittorrent Server" src="https://icons.example.com/proxmox/icons/blue/100x100/default01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> Torrent client for Sonarr02, Radarr02 and Lidarr02.<br>All torrent traffic goes through ExampleVPN. |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-16 with the community script <b>qbittorrent</b> (qBittorrent 5.2.4 static).<br>Built on pve-test, moved to pve-prod with backup and restore. Replaces Deluge01.<br>Privileged CT with /mnt/data and /dev/net/tun (the script's extra device/capability lines were removed). qBittorrent runs as sofa:admins (1020:1001), UMask 0002, profile /var/lib/qbittorrent (drop-in qbittorrent-nox.service.d/10-user.conf).<br>VPN: openvpn-client@vpn (/etc/openvpn/client/vpn.conf, login in vpn-login.txt). Leak protection: qBittorrent bound to tun0 + nftables (/etc/nftables.conf) lets uid 1020 use only lo, tun0, 192.0.2.0/24 and 198.51.100.0/24.<br>WebUI: The owner sets the password; Sonarr02/Radarr02/Lidarr02 IPs bypass login.<br>Update: run <b>update</b> as root in the CT.
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-16 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** Weekly (Sun) @ 01:00 |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.16 |
|  | **MAC:** bc:24:11:00:00:06 |
|  | **DHCP:** No |
|  | **VPN:** ExampleVPN, OpenVPN, server-01 |
| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.16:8090" target="_blank" style="text-decoration: none; color: #00f000;">qBittorrent</a> |
|  | <a href="https://192.0.2.16:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
