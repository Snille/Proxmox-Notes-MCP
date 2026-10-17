// Turns a guest's Proxmox config into the facts a Note shows. Pure functions, no network.

const OS_TYPES = {
  debian: 'Debian', ubuntu: 'Ubuntu', alpine: 'Alpine', archlinux: 'Arch Linux', centos: 'CentOS',
  fedora: 'Fedora', opensuse: 'openSUSE', gentoo: 'Gentoo', nixos: 'NixOS', devuan: 'Devuan',
  l26: 'Linux', l24: 'Linux 2.4', other: 'Other', solaris: 'Solaris',
  win11: 'Windows 11/2022/2025', win10: 'Windows 10/2016/2019', win8: 'Windows 8/2012', win7: 'Windows 7/2008 R2',
  wvista: 'Windows Vista/2008', wxp: 'Windows XP/2003', w2k8: 'Windows 2008', w2k3: 'Windows 2003', w2k: 'Windows 2000'
};

// "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:00:0A,ip=192.0.2.36/24,type=veth" -> { name: 'eth0', ... }
export function parsePropertyString(value) {
  const result = {};
  for (const part of String(value ?? '').split(',')) {
    const index = part.indexOf('=');
    if (index > 0) {
      result[part.slice(0, index)] = part.slice(index + 1);
    }
  }
  return result;
}

const QEMU_NIC_MODELS = ['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3', 'i82551', 'i82557b', 'i82559er', 'ne2k_isa', 'ne2k_pci', 'pcnet'];

function stripCidr(ip) {
  return ip ? ip.replace(/\/\d+$/, '') : '';
}

export function guestFacts(guest, config, interfaces = null) {
  const net = parsePropertyString(config.net0);
  const facts = {
    vmid: guest.vmid,
    node: guest.node,
    type: guest.type,
    status: guest.status,
    hostname: guest.type === 'lxc' ? config.hostname ?? guest.name : config.name ?? guest.name,
    ip: '',
    mac: '',
    dhcp: null,
    os: OS_TYPES[config.ostype] ?? config.ostype ?? '',
    ostype: config.ostype ?? '',
    tags: config.tags ? String(config.tags).split(/[;,\s]+/).filter(Boolean) : [],
    onboot: config.onboot === 1 || config.onboot === '1'
  };

  if (guest.type === 'lxc') {
    facts.mac = (net.hwaddr ?? '').toLowerCase();
    if (net.ip === 'dhcp') {
      facts.dhcp = true;
      const nic = interfaces?.find(i => i.name === (net.name ?? 'eth0'));
      facts.ip = stripCidr(nic?.inet);
    } else if (net.ip) {
      facts.dhcp = false;
      facts.ip = stripCidr(net.ip);
    }
  } else {
    const model = QEMU_NIC_MODELS.find(m => net[m]);
    facts.mac = model ? net[model].toLowerCase() : '';
    // Only cloud-init VMs carry their address in the config; others need the guest agent.
    const cloudInit = parsePropertyString(config.ipconfig0);
    if (cloudInit.ip === 'dhcp') {
      facts.dhcp = true;
    } else if (cloudInit.ip) {
      facts.dhcp = false;
      facts.ip = stripCidr(cloudInit.ip);
    }
  }
  return facts;
}

// Fills the field rows a template already has (IP, MAC, DHCP, OS) from the facts.
export function applyFacts(doc, facts) {
  const values = {
    ip: facts.ip,
    mac: facts.mac,
    dhcp: facts.dhcp === null ? undefined : facts.dhcp ? 'Yes' : 'No',
    os: facts.os
  };
  for (const section of doc.sections) {
    for (const row of section.rows) {
      const value = row.type === 'field' ? values[row.key.toLowerCase()] : undefined;
      if (value) {
        row.value = value;
      }
    }
  }
  if (!doc.title && facts.hostname) {
    doc.title = facts.hostname;
  }
  return doc;
}
