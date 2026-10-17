# <i class="fa fa-linux"></i> Audiobookshelf Server
| | |
| - | - |
| <img title="Audiobookshelf Server" src="https://icons.example.com/proxmox/icons/blue/100x100/audiobookshelf01-100x100.png" alt="[Icon]" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> Audiobook server (books.example.com, audiobooks.example.com). |
### <i class="fa fa-sticky-note-o"></i> Notes:
Installed 2026-10-17 with the community script <b>audiobookshelf</b> (Audiobookshelf 2.37.1, Debian package from the official repo).<br>Built on pve-test, moved to pve-prod with backup and restore. Replaces Audiobookshelf01; config and metadata (users, listening progress) were migrated.<br>Unprivileged CT. Library /mnt/data/Multimedia/Audiobooks mounted read-only (ABS only reads it). Data: /usr/share/audiobookshelf/config and /metadata, settings in /etc/default/audiobookshelf.<br>Update: run <b>update</b> as root in the CT (apt upgrade).
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-17 |
|  | **Owner:** Jane Doe |
|  | **OS:** Debian 13 |
|  | **Backup:** Weekly (Sun) @ 01:00 |
| <i class="fa fa-sitemap fa-fw"></i> **Network:** | **IP:** 192.0.2.27 |
|  | **MAC:** bc:24:11:00:00:01 |
|  | **DHCP:** No |
| <i class="fa fa-cogs"></i> **Services:** | <a href="https://books.example.com" target="_blank" style="text-decoration: none; color: #00f000;">books.example.com</a> |
|  | <a href="http://192.0.2.27:13378" target="_blank" style="text-decoration: none; color: #00f000;">Audiobookshelf (LAN)</a> |
|  | <a href="https://192.0.2.27:10000" target="_blank" style="text-decoration: none; color: #00f000;">Webmin</a> |
| <i class="fa fa-key fa-fw"></i> **Access:** | **User:** admin |
|  | **SSH Key:** Yes |
|  | **Password:** Yes |
|  | **User:** root |
|  | **Password:** No (locked) |
