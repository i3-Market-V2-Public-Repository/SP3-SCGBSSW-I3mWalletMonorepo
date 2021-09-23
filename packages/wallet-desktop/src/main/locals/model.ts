
import { Dialog } from '@i3-market/base-wallet'
import {
  Tray,
  WalletFactory,
  FeatureContext,
  Settings,
  SharedMemoryManager,
  WindowManager,
  ApiManager,
  FeatureManager,
  ActionReducer
} from '@wallet/main/internal'

export interface Locals {
  tray: Tray
  walletFactory: WalletFactory
  sharedMemoryManager: SharedMemoryManager
  settings: Settings
  windowManager: WindowManager
  apiManager: ApiManager
  featureManager: FeatureManager
  featureContext: FeatureContext
  dialog: Dialog
  actionReducer: ActionReducer
  password?: string
}
