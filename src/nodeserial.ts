import { TransportIO } from "./transport";
import type SerialPort from "serialport";

function toPromise(f: (cb: (err: any) => void) => void) {
  return new Promise<void>((resolve, reject) => {
    f((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export class NodeSerialIO implements TransportIO {
  public baudrate = 0;
  private buffers: Buffer[] = [];
  private readCb: (() => void) | undefined;
  private device: SerialPort;
  private info: SerialPort.PortInfo;

  // device should be constructed with autoOpen=false
  // 
  constructor(device: { baudRate: number }, info: { path: string }) {
    this.device = device as any;
    this.info = info as any;
    this.device.on("data", (buf) => {
      this.buffers.push(buf);
      const f = this.readCb;
      this.readCb = undefined;
      if (f) f();
    });
  }

  get_info() {
    return this.info?.productId && this.info?.vendorId
      ? `NodeSerial VendorID 0x${this.info?.vendorId} ProductID 0x${this.info?.productId}`
      : `NodeSerial ${this.device.path}`;
  }

  get_pid() {
    const pid = this.info?.productId;
    if (pid) return parseInt(pid, 16);
    return undefined;
  }

  write(out_data: Uint8Array) {
    return toPromise((cb) => this.device.write(Buffer.from(out_data), cb));
  }

  read(timeout: number) {
    return new Promise<Uint8Array>((resolve, reject) => {
      let t: any;

      this.readCb = () => {
        if (t) clearTimeout(t);
        const bufs = this.buffers;
        this.buffers = [];
        resolve(Buffer.concat(bufs));
      };

      if (timeout > 0) {
        t = setTimeout(() => {
          this.readCb = undefined;
          reject(new Error("Timeout"));
        }, timeout);
      }
    });
  }

  async setRTS(state: boolean) {
    return toPromise((cb) => this.device.set({ rts: state }, cb));
  }

  async setDTR(state: boolean) {
    return toPromise((cb) => this.device.set({ dtr: state }, cb));
  }

  async connect(baud: number) {
    if (this.device.isOpen) await this.disconnect();
    this.baudrate = baud;
    await toPromise((cb) => this.device.update({ baudRate: baud }, cb));
    await toPromise((cb) => this.device.open(cb));
  }

  async disconnect() {
    await toPromise((cb) => this.device.close(cb));
  }
}
