// scripts/no-network.mjs — preload with NODE_OPTIONS="--import=./scripts/no-network.mjs".
// Refuses every socket to a non-loopback host so `npm run build:offline` proves the build downloads nothing.
import dns from "node:dns";
import net from "node:net";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function refuse(host) {
  const error = new Error(`[no-network] blocked outbound connection to ${host}`);
  error.code = "ENETUNREACH";
  throw error;
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first !== null && typeof first === "object" ? first : {};
  const host = typeof options.path === "string" ? "localhost" : String(options.host ?? args[1] ?? "localhost");
  if (!LOOPBACK.has(host)) {
    refuse(host);
  }
  return connect.apply(this, args);
};

const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (!LOOPBACK.has(hostname)) {
    refuse(hostname);
  }
  return lookup.call(this, hostname, ...rest);
};
