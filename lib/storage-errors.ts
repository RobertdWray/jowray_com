export class RangeNotHonouredError extends Error {
  constructor() {
    super("Storage did not honour the requested byte range.");
    this.name = "RangeNotHonouredError";
  }
}

export class ShortReadError extends Error {
  constructor() {
    super("Storage returned fewer bytes than its Content-Range promised.");
    this.name = "ShortReadError";
  }
}
