import os from 'os';

export const MDNS_NAME = process.env.FEUD_HOST || 'feud';

// Interfaces that are almost never the Wi-Fi/Ethernet a phone is on
const VIRTUAL_IFACE = /^(vEthernet|VirtualBox|VMware|vmnet|vboxnet|docker|br-|veth|utun|tun|tap|wg|zt|tailscale|ham|awdl|llw|bridge|lo)/i;

function ipScore(ip, ifaceName) {
  let score = 0;
  if (/^192\.168\./.test(ip)) score += 30;
  else if (/^10\./.test(ip)) score += 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score += 10;
  if (/^169\.254\./.test(ip)) score -= 100; // link-local, no DHCP
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) score -= 40; // CGNAT / Tailscale
  if (VIRTUAL_IFACE.test(ifaceName)) score -= 50;
  if (/^(en0|en1|eth0|wlan0|wi-?fi|wireless|ethernet)/i.test(ifaceName)) score += 5;
  return score;
}

/** LAN IPv4 addresses, most likely "the one phones can reach" first */
export function localIpv4Addresses() {
  const found = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        found.push({ ip: iface.address, score: ipScore(iface.address, name) });
      }
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.ip);
}

/** Best LAN base URL for phones, or null when offline */
export function primaryLanUrl(port) {
  const [ip] = localIpv4Addresses();
  return ip ? `http://${ip}:${port}` : null;
}

/** Base URLs phones/projectors can use on the LAN */
export function networkBaseUrls(port) {
  const urls = new Set();
  for (const ip of localIpv4Addresses()) {
    urls.add(`http://${ip}:${port}`);
  }
  urls.add(`http://${MDNS_NAME}.local:${port}`);

  const hostname = os.hostname().replace(/\.local$/i, '');
  if (hostname) {
    urls.add(`http://${hostname}.local:${port}`);
  }

  urls.add(`http://localhost:${port}`);
  return [...urls];
}

export function networkInfo(port) {
  const bases = networkBaseUrls(port);
  const lanUrl = primaryLanUrl(port);
  return {
    port,
    mdnsName: MDNS_NAME,
    mdnsUrl: `http://${MDNS_NAME}.local:${port}`,
    lanUrl,
    controlUrl: lanUrl ? `${lanUrl}/control/` : null,
    bases,
    display: bases.map((b) => `${b}/display/`),
    control: bases.map((b) => `${b}/control/`),
  };
}
