import { Wallet, WalletBuilder, WalletMetadata } from '@i3m/base-wallet'
import { WalletMetadataMap } from '@wallet/lib'
import {
  logger,
  Locals,
  FeatureManager,
  Feature,
  storeFeature,
  FeatureHandler,
  StartFeatureError
} from '@wallet/main/internal'

import { InvalidWalletError, NoWalletSelectedError } from './errors'

interface WalletFeatureMap {
  [name: string]: Array<Feature<any>> | undefined
}

interface FeatureMap {
  [name: string]: FeatureHandler<any>
}

const featureMap: FeatureMap = {
  store: storeFeature
}

export class WalletFactory {
  protected _wallet: Wallet | undefined
  protected _walletName: string | undefined

  protected featuresByWallet: WalletFeatureMap

  constructor (protected locals: Locals) {
    this._walletName = undefined
    this.featuresByWallet = {}

    // Change wallet if global state changes
    const { sharedMemoryManager } = locals
    sharedMemoryManager.on('change', (mem, oldMem) => {
      const current = mem.settings.wallet.current
      const old = oldMem.settings.wallet.current

      // Update current wallet
      if (current !== undefined && current !== old) {
        const { walletFactory } = locals
        walletFactory.changeWallet(current).catch((err) => {
          console.log(err)
        })
      }
    })
  }

  async initialize (): Promise<void> {
    await this.loadWalletsMetadata()

    const wallet = this.locals.settings.get('wallet')
    if (wallet.current === undefined) {
      return
    }

    await this.changeWallet(wallet.current)
  }

  async loadWalletsMetadata (): Promise<void> {
    const walletsMetadata: WalletMetadataMap = {}
    for (const walletPackage of this.walletPackages) {
      const packageJson = await import(`${walletPackage}/package.json`)
      logger.info(`Loaded metadata for wallet '${walletPackage}'`)

      // Store wallet metadata
      const walletMetadata: WalletMetadata = packageJson.walletMetadata
      walletsMetadata[walletPackage] = walletMetadata

      // Initialize features
      const features: Array<Feature<any>> = []
      for (const [name, featureArgs] of Object.entries(walletMetadata.features)) {
        features.push(FeatureManager.CreateFeature(featureMap[name], featureArgs))
      }
      this.featuresByWallet[walletPackage] = features
    }

    const { sharedMemoryManager } = this.locals
    sharedMemoryManager.update((mem) => ({
      ...mem,
      walletsMetadata
    }))
  }

  async buildWallet (walletName: string): Promise<Wallet> {
    const { settings, featureContext, featureManager, dialog, toast } = this.locals
    const { wallets } = settings.get('wallet')
    const walletInfo = wallets[walletName]
    if (walletInfo === undefined) {
      throw new Error('Inconsistent data!')
    }

    try {
      // Init wallet features
      // Initialize all the features
      await featureManager.clearFeatures(this.locals)
      const features = this.featuresByWallet[walletInfo.package]
      if (features !== undefined) {
        for (const feature of features) {
          featureManager.addFeature(feature)
        }
      }
      await featureManager.start(this.locals)

      // Initialize wallet
      const walletMain: WalletBuilder<any> = (await import(walletInfo.package)).default
      const wallet = await walletMain({
        ...walletInfo.args,

        store: featureContext.store,
        toast,
        dialog
      })

      return wallet
    } catch (err) {
      // Start errors should be bypassed
      if (err instanceof StartFeatureError) {
        throw err
      }
      if (err instanceof Error) {
        logger.error(err.stack)
      } else {
        logger.error(err)
      }

      throw new InvalidWalletError(`Cannot load the wallet '${walletName}'`)
    }
  }

  async changeWallet (walletName: string): Promise<void> {
    if (walletName === this._walletName) {
      return
    }

    logger.info(`Change wallet to ${walletName}`)
    const { settings, sharedMemoryManager, apiManager } = this.locals

    // Stop API
    await apiManager.close()

    // Build the current wallet
    this._walletName = walletName
    try {
      this._wallet = await this.buildWallet(walletName)
    } catch (err) {
      this._wallet = undefined
      this._walletName = undefined
      this.locals.toast.show({
        message: 'Wallet initialization',
        details: `Could not initialize the wallet '${walletName}'`,
        type: 'warning'
      })
      this.locals.sharedMemoryManager.update((mem) => ({
        ...mem,
        settings: {
          ...mem.settings,
          wallet: {
            ...mem.settings.wallet,
            current: undefined
          }
        }
      }))
      return
    }

    // Setup the resource list inside shared memory
    const identities = await this.wallet.getIdentities()
    const resources = await this.wallet.getResources()
    await sharedMemoryManager.update((mem) => ({
      ...mem, identities, resources
    }))

    // Update current wallet
    settings.set('wallet.current', walletName)

    // Start API
    await apiManager.listen()
  }

  get walletNames (): string[] {
    return Object.keys(this.locals.sharedMemoryManager.memory.settings.wallet.wallets)
  }

  get walletPackages (): string[] {
    return this.locals.sharedMemoryManager.memory.settings.wallet.packages
  }

  get walletName (): string | undefined {
    return this._walletName
  }

  get wallet (): Wallet {
    if (this._wallet === undefined) {
      throw new NoWalletSelectedError('Wallet not select. Maybe you might initialize the wallet factory first.')
    }

    return this._wallet
  }

  get hasWalletSelected (): boolean {
    return this._wallet !== undefined
  }
}
