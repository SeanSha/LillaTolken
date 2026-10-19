// Detects local AI engine ports that answer on the Mac's LAN address(es). Local engines must only
// listen on loopback; anything on the same Wi-Fi could otherwise drive them. The check only ever
// connects to this Mac's OWN interface addresses (traffic never leaves the host).
import net from 'node:net';
import os from 'node:os';

export type Endpoint = { name: string; url: string };
export type Exposure = { name: string; port: number; address: string };

export type Connector = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

export const tcpConnect: Connector = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

export function lanAddresses(interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.family === 'IPv4') out.push(a.address);
    }
  }
  return out;
}

export async function findLanExposure(
  endpoints: Endpoint[],
  deps: { connect?: Connector; addresses?: string[]; timeoutMs?: number } = {},
): Promise<Exposure[]> {
  const connect = deps.connect ?? tcpConnect;
  const addresses = deps.addresses ?? lanAddresses();
  const found: Exposure[] = [];
  for (const endpoint of endpoints) {
    let port: number;
    try {
      const u = new URL(endpoint.url);
      port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    } catch {
      continue;
    }
    for (const address of addresses) {
      if (await connect(address, port, deps.timeoutMs ?? 700)) {
        found.push({ name: endpoint.name, port, address });
        break;
      }
    }
  }
  return found;
}
