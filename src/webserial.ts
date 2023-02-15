import { TransportIO } from "./transport";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WebSerialIO implements TransportIO {
  public baudrate = 0;

  constructor(public device: SerialPort) {}

  get_info() {
    const info = this.device.getInfo();
    return info.usbVendorId && info.usbProductId
      ? `WebSerial VendorID 0x${info.usbVendorId.toString(16)} ProductID 0x${info.usbProductId.toString(16)}`
      : "";
  }

  get_pid() {
    return this.device.getInfo().usbProductId;
  }

  async write(out_data: Uint8Array) {
    if (this.device.writable == null) throw new Error("Fatal write error");
    const writer = this.device.writable.getWriter();
    await writer.write(out_data);
    writer.releaseLock();
  }

  async read(timeout: number) {
    if (this.device.readable == null) throw new Error("Fatal read error");

    const reader = this.device.readable.getReader();
    let t: any;
    try {
      if (timeout > 0) {
        t = setTimeout(function () {
          reader.cancel();
        }, timeout);
      }
      const { value, done } = await reader.read();
      if (done) {
        throw new Error("Timeout");
      }
      return value;
    } finally {
      if (timeout > 0) {
        clearTimeout(t);
      }
      reader.releaseLock();
    }
  }

  async setRTS(state: boolean) {
    await this.device.setSignals({ requestToSend: state });
  }

  async setDTR(state: boolean) {
    await this.device.setSignals({ dataTerminalReady: state });
  }

  async connect(baud: number) {
    await this.device.open({ baudRate: baud });
    this.baudrate = baud;
  }

  private async waitForUnlock(timeout: number) {
    while (
      (this.device.readable && this.device.readable.locked) ||
      (this.device.writable && this.device.writable.locked)
    ) {
      await sleep(timeout);
    }
  }

  async disconnect() {
    await this.waitForUnlock(400);
    await this.device.close();
  }
}
