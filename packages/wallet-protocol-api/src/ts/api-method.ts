import { WalletPaths } from '@i3m/wallet-desktop-openapi/types'

export interface ApiMethod<T> {
  path: string
  method: string
  headers?: Record<string, string>
  _nothing?: T
}

export const GET_IDENTITIES: ApiMethod<WalletPaths.IdentityList.Responses.$200> = {
  path: 'identities',
  method: 'GET'
}
