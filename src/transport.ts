interface TransportIO {
  baudrate: number;
  get_info(): string;
  get_pid(): number | undefined;
  write(out_data: Uint8Array): Promise<void>;
  read(timeout: number): Promise<Uint8Array>;
  setRTS(state: boolean): Promise<void>;
  setDTR(state: boolean): Promise<void>;
  connect(baud: number): Promise<void>;
  disconnect(): Promise<void>;
}

class Transport {
  public slip_reader_enabled = false;
  public left_over = new Uint8Array(0);

  constructor(public io: TransportIO) {}

  get baudrate() {
    return this.io.baudrate;
  }

  get_info() {
    return this.io.get_info();
  }

  get_pid() {
    return this.io.get_pid();
  }

  slip_writer(data: Uint8Array) {
    let count_esc = 0;
    let i = 0,
      j = 0;

    for (i = 0; i < data.length; i++) {
      if (data[i] === 0xc0 || data[i] === 0xdb) {
        count_esc++;
      }
    }
    const out_data = new Uint8Array(2 + count_esc + data.length);
    out_data[0] = 0xc0;
    j = 1;
    for (i = 0; i < data.length; i++, j++) {
      if (data[i] === 0xc0) {
        out_data[j++] = 0xdb;
        out_data[j] = 0xdc;
        continue;
      }
      if (data[i] === 0xdb) {
        out_data[j++] = 0xdb;
        out_data[j] = 0xdd;
        continue;
      }

      out_data[j] = data[i];
    }
    out_data[j] = 0xc0;
    return out_data;
  }

  async write(data: Uint8Array) {
    const out_data = this.slip_writer(data);
    await this.io.write(out_data);
  }

  _appendBuffer(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
    const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp;
  }

  /* this function expects complete packet (hence reader reads for atleast 8 bytes. This function is
   * stateless and returns the first wellformed packet only after replacing escape sequence */
  slip_reader(data: Uint8Array) {
    let i = 0;
    let data_start = 0,
      data_end = 0;
    let state = "init";
    while (i < data.length) {
      if (state === "init" && data[i] == 0xc0) {
        data_start = i + 1;
        state = "valid_data";
        i++;
        continue;
      }
      if (state === "valid_data" && data[i] == 0xc0) {
        data_end = i - 1;
        state = "packet_complete";
        break;
      }
      i++;
    }
    if (state !== "packet_complete") {
      this.left_over = data;
      return new Uint8Array(0);
    }

    this.left_over = data.slice(data_end + 2);
    const temp_pkt = new Uint8Array(data_end - data_start + 1);
    let j = 0;
    for (i = data_start; i <= data_end; i++, j++) {
      if (data[i] === 0xdb && data[i + 1] === 0xdc) {
        temp_pkt[j] = 0xc0;
        i++;
        continue;
      }
      if (data[i] === 0xdb && data[i + 1] === 0xdd) {
        temp_pkt[j] = 0xdb;
        i++;
        continue;
      }
      temp_pkt[j] = data[i];
    }
    const packet = temp_pkt.slice(0, j); /* Remove unused bytes due to escape seq */
    return packet;
  }

  async read(timeout = 0, min_data = 12) {
    let packet = this.left_over;
    this.left_over = new Uint8Array(0);
    if (this.slip_reader_enabled) {
      const val_final = this.slip_reader(packet);
      if (val_final.length > 0) {
        return val_final;
      }
      packet = this.left_over;
      this.left_over = new Uint8Array(0);
    }

    try {
      do {
        const segment = await this.io.read(timeout);
        packet = this._appendBuffer(packet.buffer, segment.buffer);
      } while (packet.length < min_data);
    } catch (e) {
      this.left_over = packet;
      throw e;
    }

    if (this.slip_reader_enabled) {
      return this.slip_reader(packet);
    } else {
      return packet;
    }
  }

  async rawRead(timeout = 0) {
    return await this.io.read(timeout);
  }

  _DTR_state = false;
  async setRTS(state: boolean) {
    await this.io.setRTS(state);
    // # Work-around for adapters on Windows using the usbser.sys driver:
    // # generate a dummy change to DTR so that the set-control-line-state
    // # request is sent with the updated RTS state and the same DTR state
    // Referenced to esptool.py
    await this.io.setDTR(this._DTR_state);
  }

  async setDTR(state: boolean) {
    this._DTR_state = state;
    await this.io.setDTR(state);
  }

  async connect(baud = 115200) {
    await this.io.connect(baud);
    this.left_over = new Uint8Array(0);
  }

  async disconnect() {
    await this.io.disconnect();
  }
}

export { Transport, TransportIO };
