import os from 'os';

export const MDNS_NAME = process.env.FEUD_HOST || 'feud';

export function localIpv4Addresses() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

/** Base URLs phones/projectors can use on the LAN */
export function networkBaseUrls(port) {
  const urls = new Set([`http://${MDNS_NAME}.local:${port}`]);

  const hostname = os.hostname().replace(/\.local$/i, '');
  if (hostname) {
    urls.add(`http://${hostname}.local:${port}`);
  }

  for (const ip of localIpv4Addresses()) {
    urls.add(`http://${ip}:${port}`);
  }

  urls.add(`http://localhost:${port}`);
  return [...urls];
}

export function networkInfo(port) {
  const bases = networkBaseUrls(port);
  return {
    port,
    mdnsName: MDNS_NAME,
    mdnsUrl: `http://${MDNS_NAME}.local:${port}`,
    bases,
    display: bases.map((b) => `${b}/display/`),
    control: bases.map((b) => `${b}/control/`),
  };
}
