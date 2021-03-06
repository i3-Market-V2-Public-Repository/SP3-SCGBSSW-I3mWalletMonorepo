import { random, format, bufferUtils, constants } from '../internal'

export class ConnectionString {
  constructor (protected buffer: Uint8Array, protected l: number) { }

  toString (): string {
    return format.u8Arr2Base64(this.buffer)
  }

  extractPort (): number {
    const portBytesLen = Math.ceil(constants.PORT_LENGTH / 8)
    const portBytesOffset = this.l % 8
    const portBytes = new Uint8Array(portBytesLen)
    bufferUtils.insertBits(this.buffer, portBytes, this.l, portBytesOffset, constants.PORT_LENGTH)
    const dport = format.u8Arr2Num(portBytes)
    return constants.INITIAL_PORT + dport
  }

  extractRb (): Uint8Array {
    return bufferUtils.extractBits(this.buffer, 0, this.l)
  }

  static async generate (port: number, l: number): Promise<ConnectionString> {
    const connBytesLen = Math.ceil((l + constants.PORT_LENGTH) / 8)

    const buf = new Uint8Array(connBytesLen)
    await random.randomFillBits(buf, 0, l)

    const dport = port - constants.INITIAL_PORT
    if (dport < 0 || dport > constants.PORT_SPACE) {
      throw new Error(`the port ${port} is out of the port space`)
    }

    const portBytes = format.num2U8Arr(dport, 2)
    bufferUtils.insertBits(portBytes, buf, 2 * 8 - constants.PORT_LENGTH, l, constants.PORT_LENGTH)

    return new ConnectionString(buf, l)
  }

  static fromString (connString: string, l: number): ConnectionString {
    return new ConnectionString(format.base642U8Arr(connString), l)
  }
}
