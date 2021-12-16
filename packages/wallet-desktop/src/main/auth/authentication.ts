import { dialog as electronDialogs } from 'electron'
import pbkdf2Hmac from 'pbkdf2-hmac'
import crypto from 'crypto'

import { Locals } from '@wallet/main/internal'
import { AuthSettings } from '@wallet/lib'

interface PbkdfSettings {
  usage: string
  iterations: number
  keyLength: number
}

export class LocalAuthentication {
  protected maxTries: number
  protected passwordRegex: RegExp
  protected passwordRegexMessage: string

  protected pekSettings: PbkdfSettings
  protected authSettings: PbkdfSettings
  protected pek?: Buffer

  constructor (protected locals: Locals) {
    this.maxTries = 3
    this.passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/
    this.passwordRegexMessage = 'Password must fulfill: \nMinimum eight characters, at least one uppercase letter, one lowercase letter and one number:'
    this.pekSettings = {
      iterations: 50000,
      keyLength: 32,
      usage: 'pek'
    }
    this.authSettings = {
      iterations: 100000,
      keyLength: 32,
      usage: 'local'
    }
  }

  private verifyPasswordRegex (password: string): boolean {
    const match = password.match(this.passwordRegex) !== null
    if (!match) {
      electronDialogs.showMessageBoxSync({
        message: this.passwordRegexMessage
      })
      return false
    }

    return true
  }

  private async askValidPassword (
    message: (triesLeft: number) => string,
    extraChecks: (password: string) => Promise<boolean> = async () => true
  ): Promise<string | undefined> {
    const { dialog } = this.locals

    let leftTries = this.maxTries
    while (leftTries > 0) {
      const password = await dialog.text({
        message: message(leftTries--),
        allowCancel: false,
        hiddenText: true
      })

      if (password === undefined) {
        break
      }

      if (!this.verifyPasswordRegex(password)) {
        continue
      }

      if (await extraChecks(password)) {
        return password
      }
    }
  }

  private async deriveKey (password: string | ArrayBuffer, salt: ArrayBuffer, settings: PbkdfSettings): Promise<ArrayBuffer> {
    let passwordBuffer: ArrayBuffer
    if (password instanceof ArrayBuffer) {
      passwordBuffer = password
    } else {
      passwordBuffer = Buffer.from(password)
    }
    const usageBuffer = Buffer.from(settings.usage)

    const p = new Uint8Array(passwordBuffer.byteLength + usageBuffer.byteLength)
    p.set(new Uint8Array(passwordBuffer), 0)
    p.set(new Uint8Array(usageBuffer), passwordBuffer.byteLength)

    return await pbkdf2Hmac(
      p,
      salt,
      settings.iterations,
      settings.keyLength
    )
  }

  private async initializePassword (): Promise<void> {
    const message = (tries: number): string => `You don't have an application password: setup a new one (${tries} left).`
    const validPassword = await this.askValidPassword(message)

    if (validPassword === undefined) {
      throw new Error('tries exceeded')
    }

    const salt = await crypto.randomBytes(16)
    const localAuth = await this.deriveKey(validPassword, salt, this.authSettings)
    const auth: AuthSettings = {
      salt: salt.toString('base64'),
      localAuth: Buffer.from(localAuth).toString('base64')
    }
    this.locals.settings.set('auth', auth)

    this.pek = Buffer.from(await this.deriveKey(validPassword, salt, this.pekSettings))
  }

  private async localAuthentication (auth: AuthSettings): Promise<void> {
    const salt = Buffer.from(auth.salt, 'base64')
    const testLocalAuth = Buffer.from(auth.localAuth, 'base64')

    const message = (tries: number): string => `Enter the application password. You have ${tries} left.`
    const validPassword = await this.askValidPassword(message, async (password) => {
      const localAuth = await this.deriveKey(password, salt, this.authSettings)
      return testLocalAuth.equals(new Uint8Array(localAuth))
    })

    if (validPassword === undefined) {
      throw new Error('tries exceeded')
    }

    this.pek = Buffer.from(await this.deriveKey(validPassword, salt, this.pekSettings))
  }

  async authenticate (): Promise<void> {
    const { settings } = this.locals

    const auth = settings.get('auth')
    if (auth === undefined) {
      await this.initializePassword()
    } else {
      await this.localAuthentication(auth)
    }
  }

  async computeWalletKey (walletUuid: string): Promise<Buffer> {
    if (this.pek === undefined) {
      throw new Error('cannot compute wallet key before a correct application authentication')
    }
    const wkSettings: PbkdfSettings = {
      ...this.pekSettings,
      usage: walletUuid
    }

    const salt = crypto.createHash('sha256').update(this.pek).digest()
    const wk = await this.deriveKey(this.pek, salt.subarray(0, 15), wkSettings)

    return Buffer.from(wk)
  }
}