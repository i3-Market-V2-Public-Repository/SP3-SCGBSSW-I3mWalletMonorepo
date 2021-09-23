import { WalletPaths } from '@i3-market/wallet-desktop-openapi/types'

import { createIdentityAction } from '@wallet/lib'
import { extractLocals } from '@wallet/main/locals'
import { asyncHandler } from './async-handler'

export const identityList = asyncHandler<never, WalletPaths.IdentityList.Responses.$200, never, WalletPaths.IdentityList.QueryParameters>(async (req, res) => {
  const { walletFactory } = extractLocals(req.app)
  const response = await walletFactory.wallet.identityList(req.query)
  res.json(response)
})

export const identitySelect = asyncHandler<never, WalletPaths.IdentitySelect.Responses.$200, never, WalletPaths.IdentitySelect.QueryParameters>(async (req, res) => {
  const { walletFactory } = extractLocals(req.app)
  const response = await walletFactory.wallet.identitySelect(req.query)
  res.json(response)
})

export const identityCreate = asyncHandler<never, WalletPaths.IdentityCreate.Responses.$201, WalletPaths.IdentityCreate.RequestBody>(async (req, res) => {
  const { actionReducer } = extractLocals(req.app)
  await actionReducer.fromApi(req, res, createIdentityAction)
})
