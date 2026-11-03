// Covers the main thread of every Node process that inherits NODE_OPTIONS (prisma generate, next build and its child processes).
// Not covered: worker threads (Node does not run --import preloads in them) and native code; see docs/code-layout.md.
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
  let host = "localhost";
  if (typeof first === "number") {
    host = typeof args[1] === "string" ? args[1] : "localhost"; // connect(port[, host][, cb])
  } else if (first !== null && typeof first === "object") {
    host = typeof first.path === "string" ? "localhost" : String(first.host ?? "localhost"); // connect(options[, cb])
  } // typeof first === "string": connect(path[, cb]) — an IPC path, always local
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

const lookupPromise = dns.promises.lookup;
dns.promises.lookup = async function (hostname, ...rest) {
  if (!LOOPBACK.has(hostname)) {
    refuse(hostname);
  }
  return lookupPromise.call(this, hostname, ...rest);
};
