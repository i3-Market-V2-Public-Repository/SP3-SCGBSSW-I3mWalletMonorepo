import { WalletComponents, WalletPaths } from '@i3m/wallet-desktop-openapi/types'
import { IIdentifier, IMessage, VerifiableCredential, VerifiablePresentation } from '@veramo/core'
import { ethers } from 'ethers'
import _ from 'lodash'
import * as u8a from 'uint8arrays'
import { v4 as uuid } from 'uuid'

import { BaseWalletModel, DescriptorsMap, Dialog, Identity, Store, Toast } from '../app'
import { WalletError } from '../errors'
import { KeyWallet } from '../keywallet'
import { ResourceValidator } from '../resource'
import { getCredentialClaims } from '../utils'
import { displayDid } from '../utils/display-did'
import Veramo from '../veramo'
import { DEFAULT_PROVIDER } from '../veramo/veramo'

import { Wallet } from './wallet'
import { WalletFunctionMetadata } from './wallet-metadata'
import { WalletOptions } from './wallet-options'

interface SdrClaim {
  claimType: string
  essential: boolean | undefined
}

interface SelectiveDisclosureData {
  claims: SdrClaim[]
}

interface CandidateClaim extends SdrClaim {
  credentials: VerifiableCredential[]
}

interface CandidateIdentity {
  [claimType: string]: CandidateClaim
}

interface CandidateIdentities {
  [did: string]: CandidateIdentity
}

interface VerifiableCredentialMap {
  [k: string]: VerifiableCredential
}

interface SelectIdentityOptions {
  reason?: string
}

interface TransactionData {
  from: IIdentifier
  to: string
  value: string
  sign: boolean
}

interface TransactionOptions {
  transaction?: string
  notifyUser?: boolean
}

export class BaseWallet<
  Options extends WalletOptions<Model>,
  Model extends BaseWalletModel = BaseWalletModel
> implements Wallet {
  public dialog: Dialog
  public store: Store<Model>
  public toast: Toast
  public veramo: Veramo<Model>

  protected keyWallet: KeyWallet
  protected resourceValidator: ResourceValidator
  protected provider: string

  constructor (opts: Options) {
    this.dialog = opts.dialog
    this.store = opts.store
    this.toast = opts.toast
    this.keyWallet = opts.keyWallet
    this.resourceValidator = new ResourceValidator()
    this.provider = opts.provider ?? DEFAULT_PROVIDER

    // Init veramo framework
    this.veramo = new Veramo(this.store, this.keyWallet)
  }

  prepareForJWSSigning (messageToSign: any): any {

  }

  async executeTransaction (options: TransactionOptions = {}): Promise<void> {
    const providerData = this.veramo.providersData[this.provider]
    if (providerData?.rpcUrl === undefined) {
      throw new WalletError('This provider has incomplete information, cannot execute transaction')
    }
    let transaction = options.transaction
    const notifyUser = options.notifyUser ?? true

    if (transaction === undefined) {
      transaction = await this.dialog.text({
        title: 'Execute transaction',
        message: 'Put the transaction. Should start with 0x'
      })
    }
    if (transaction === undefined || !transaction.startsWith('0x')) {
      throw new WalletError(`Invalid transaction ${transaction ?? '<undefined>'}`)
    }

    const provider = new ethers.providers.JsonRpcProvider(providerData.rpcUrl)
    const response = await provider.sendTransaction(transaction)
    if (notifyUser) {
      const recipt = await response.wait()
      this.toast.show({
        message: 'Transaction properly executed!',
        type: 'success'
      })
      console.log(recipt)
    } else {
      console.log(response)
    }
  }

  async queryBalance (): Promise<void> {
    const providerData = this.veramo.providersData[this.provider]
    if (providerData?.rpcUrl === undefined) {
      throw new WalletError('This provider has incomplete information, cannot execute transaction')
    }

    const identities = await this.veramo.agent.didManagerFind()
    const identity = await this.dialog.select({
      message: 'Select an account to get its balance.',
      values: identities,
      getText (identity) {
        return identity.alias ?? identity.did
      }
    })
    if (identity === undefined) {
      throw new WalletError('Query balance cancelled')
    }

    const provider = new ethers.providers.JsonRpcProvider(providerData.rpcUrl)
    const address = ethers.utils.computeAddress(`0x${identity.keys[0].publicKeyHex}`)
    const balance = await provider.getBalance(address)
    const ether = ethers.utils.formatEther(balance)

    this.toast.show({
      message: 'Balance',
      details: `The account '${address}' current balance is ${ether} ETH.`,
      type: 'success'
    })
  }

  async createTransaction (): Promise<void> {
    const providerData = this.veramo.providersData[this.provider]
    if (providerData?.rpcUrl === undefined) {
      throw new WalletError('This provider has incomplete information, cannot execute transaction')
    }

    const identities = await this.veramo.agent.didManagerFind()
    const transactionData = await this.dialog.form<TransactionData>({
      title: 'Create Transaction',
      descriptors: {
        from: {
          type: 'select',
          message: 'Select the origin account',
          values: identities,
          getText (identity) {
            return identity.alias ?? '<UNKNOWN>'
          }
        },
        to: { type: 'text', message: 'Type the destination account' },
        value: { type: 'text', message: 'Put the ether value' },
        sign: { type: 'confirmation', message: 'Sign the transaction?', acceptMsg: 'Sign', rejectMsg: 'Cancel' }
      },
      order: ['from', 'to', 'value', 'sign']
    })
    if (transactionData === undefined) {
      throw new WalletError('Create transaction cancelled')
    }

    const provider = new ethers.providers.JsonRpcProvider(providerData.rpcUrl)
    const from = ethers.utils.computeAddress(`0x${transactionData.from.keys[0].publicKeyHex}`)
    const nonce = await provider.getTransactionCount(from, 'latest')
    const gasPrice = await provider.getGasPrice()

    const tx = {
      to: transactionData.to,
      value: ethers.utils.parseEther(transactionData.value),
      nonce,
      gasLimit: ethers.utils.hexlify(100000),
      gasPrice
    }

    let transaction: string = ''
    if (transactionData.sign) {
      const response = await this.identitySign({ did: transactionData.from.did }, { type: 'Transaction', data: { ...tx, from } })
      transaction = response.signature
    } else {
      transaction = ethers.utils.serializeTransaction(tx)
    }

    await this.dialog.confirmation({
      message: `Transaction created, click the input to copy its value.\n<input value="${transaction}" disabled></input>`,
      acceptMsg: 'Continue',
      rejectMsg: ''
    })
  }

  async wipe (): Promise<void> {
    const confirmation = await this.dialog.confirmation({
      title: 'Delete Wallet?',
      message: 'Are you sure you want to delete this wallet?',
      acceptMsg: 'Delete',
      rejectMsg: 'Cancel'
    })
    if (confirmation !== true) {
      throw new WalletError('Operation rejected by user')
    }

    await Promise.all([
      this.store.clear(),
      this.keyWallet.wipe()
    ])
  }

  // UTILITIES
  async selectIdentity (options?: SelectIdentityOptions): Promise<Identity> {
    const identities = await this.veramo.agent.didManagerFind()
    const message = `${options?.reason ?? 'Authentication required. Please, select an identity to proceed.'}`
    const identity = await this.dialog.select({
      message,
      values: identities,
      getText: (ddo) => ddo.alias !== undefined ? ddo.alias : ddo.did
    })
    if (identity === undefined) {
      throw new WalletError('No did selected')
    }
    return identity
  }

  async selectCredentialsForSdr (sdrMessage: IMessage): Promise<VerifiablePresentation | undefined> {
    if (sdrMessage.data === null || sdrMessage.data === undefined || sdrMessage.from === undefined) {
      return
    }

    const sdrData = sdrMessage.data as SelectiveDisclosureData

    // ** Step 1: Organize the data in an easy to work data structure **

    // Map from DID to its credentials related with this SDR
    const candidateIdentities: CandidateIdentities = {}
    const resources = await this.store.get('resources', {})
    for (const resource of Object.values(resources)) {
      if (resource.type !== 'VerifiableCredential' || resource.identity === undefined) continue

      for (const claim of Object.keys(resource.resource.credentialSubject)) {
        if (claim === 'id') continue

        const requiredClaim = sdrData.claims.find((v) => v.claimType === claim)
        if (requiredClaim !== undefined) {
          let candidateIdentity = candidateIdentities[resource.identity]
          if (candidateIdentity === undefined) {
            candidateIdentity = {}
            candidateIdentities[resource.identity] = candidateIdentity
          }

          let candidateClaim = candidateIdentity[requiredClaim.claimType]
          if (candidateClaim === undefined) {
            candidateClaim = {
              ...requiredClaim,
              credentials: []
            }
            candidateIdentity[requiredClaim.claimType] = candidateClaim
          }

          candidateClaim.credentials.push(resource.resource)
        }
      }
    }

    // ** Step 2: Select the identities that have all the essential claims **

    const validIdentities: CandidateIdentities = {}
    const essentialClaims = sdrData.claims.filter((claim) => claim.essential === true)
    for (const did of Object.keys(candidateIdentities)) {
      const candidateIdentity = candidateIdentities[did]

      // If an identity do no has an essential claim, this identity is marked as invalid
      let valid = true
      for (const essentialClaim of essentialClaims) {
        if (candidateIdentity[essentialClaim.claimType] === undefined) {
          valid = false
          break
        }
      }

      if (valid) {
        validIdentities[did] = candidateIdentity
      }
    }

    // ** Step 3: Select one of the valid identities **

    let selectedDid: string | undefined
    const validDids = Object.keys(validIdentities)
    if (validDids.length === 0) {
      // There is no valid identity. Do no select any
    } else if (validDids.length === 1) {
      // There is only one identity fulfilling the requirement. Use this identity
      selectedDid = Object.keys(validIdentities)[0]
    } else {
      // Select one of the valid identities
      const identities = (await this.veramo.agent.didManagerFind()).filter(identity => validDids.includes(identity.did))
      const message = `Requested claims ${sdrData.claims.map(claim => claim.claimType).join(',')} are available in the following identities. Please select one to continue...`
      const identity = await this.dialog.select({
        message,
        values: identities,
        getText: (identity) => {
          return identity.alias !== undefined ? `${identity.alias} (${displayDid(identity.did)})` : displayDid(identity.did)
        }
      })
      if (identity !== undefined) {
        selectedDid = identity.did
      }
    }

    if (selectedDid === undefined) {
      throw new WalletError('Selective disclousure cancelled by the user')
    }
    const selectedIdentity = validIdentities[selectedDid]

    // ** Step 4: Execute the selective disclosure **
    const credentials: VerifiableCredential[] = []
    do {
      const disclosure = await this.dialog.form<VerifiableCredentialMap>({
        title: 'Selective disclosure',
        descriptors: Object.values(selectedIdentity).reduce((prev, claim) => {
          const descriptors: DescriptorsMap<VerifiableCredentialMap> = {
            ...prev,
            [claim.claimType]: {
              type: 'select',
              message: `${sdrMessage.from ?? 'UNKNOWN'} has requested the claim <b>${claim.claimType}</b>.You have the following claim/s that meet the request. \nSelect the claim to disclouse or leave empty for not disclousing it.${claim.essential === true ? '\n<b>This claim is compulsory. Not disclosing it will cancel the disclosure.</b>' : ''}`,
              values: [undefined, ...claim.credentials],

              getText (credential) {
                if (credential === undefined) {
                  return 'Don\'t disclose'
                }
                const value = credential.credentialSubject[claim.claimType] as string
                return `${claim.claimType}=${value} (by ${displayDid(credential.issuer.id)})`
              },
              getContext (credential) {
                return credential !== undefined ? 'success' : 'danger'
              }
            }
          }

          return descriptors
        }, {}),
        order: Object.keys(selectedIdentity)
      })

      if (disclosure === undefined) {
        const cancel = await this.dialog.confirmation({
          message: 'You cancelled the selective disclosure. Are you sure?',
          acceptMsg: 'Yes',
          rejectMsg: 'No',
          allowCancel: false
        })
        if (cancel === true) {
          throw new WalletError('Selective disclosure denied')
        }
      } else {
        const missingEssentials: string[] = []
        for (const [claimType, credential] of Object.entries(disclosure)) {
          if (credential === undefined) {
            // Check essential credential skipped
            const claim = essentialClaims.find((claim) => claim.claimType === claimType)
            if (claim !== undefined) {
              missingEssentials.push(claimType)
            }
            continue
          }
          credentials.push(credential)
        }

        let continueSelectiveDisclosure: boolean | undefined
        if (missingEssentials.length > 0) {
          continueSelectiveDisclosure = await this.dialog.confirmation({
            message: `You skipped the mandatory claims: ${missingEssentials.join(', ')}. <b>The selective disclosure will be canceled</b>. \nContinue?`,
            acceptMsg: 'No',
            rejectMsg: 'Yes',
            allowCancel: false
          })
        } else if (credentials.length === 0) {
          continueSelectiveDisclosure = await this.dialog.confirmation({
            message: 'You did not select any claim.<b>The selective disclosure will be canceled</b>. \nContinue?',
            acceptMsg: 'No',
            rejectMsg: 'Yes',
            allowCancel: false
          })
        } else {
          break
        }

        if (continueSelectiveDisclosure === false) {
          throw new WalletError('Selective disclosure denied')
        }
      }
    } while (true)

    // ** Step 5: Generate Verifiable Presentation **

    const vp = await this.veramo.agent.createVerifiablePresentation({
      presentation: {
        holder: selectedDid,
        verifier: [sdrMessage.from],
        verifiableCredential: credentials,
        request: sdrMessage.raw
      },
      proofFormat: 'jwt',
      save: false
    })

    return vp
  }

  getKeyWallet<T extends KeyWallet> (): T {
    return this.keyWallet as T
  }

  async call (functionMetadata: WalletFunctionMetadata): Promise<void> {
    await (this as any)[functionMetadata.call]()
  }

  // API METHODS
  async getIdentities (): Promise<BaseWalletModel['identities']> {
    return await this.store.get('identities', {})
  }

  async identityList (queryParameters: WalletPaths.IdentityList.QueryParameters): Promise<WalletPaths.IdentityList.Responses.$200> {
    const { alias } = queryParameters
    const identities = await this.veramo.agent.didManagerFind({ alias })
    return identities.map(ddo => ({ did: ddo.did }))
  }

  async identityCreate (requestBody: WalletPaths.IdentityCreate.RequestBody): Promise<WalletPaths.IdentityCreate.Responses.$201> {
    const { alias } = requestBody
    const { did } = await this.veramo.agent.didManagerCreate({
      alias,
      provider: this.provider
    })
    return { did }
  }

  async identitySelect (queryParameters: WalletPaths.IdentitySelect.QueryParameters): Promise<WalletPaths.IdentitySelect.Responses.$200> {
    const { did } = await this.selectIdentity(queryParameters)
    return { did }
  }

  async identitySign (pathParameters: WalletPaths.IdentitySign.PathParameters, requestBody: WalletPaths.IdentitySign.RequestBody): Promise<WalletPaths.IdentitySign.Responses.$200> {
    let response: WalletPaths.IdentitySign.Responses.$200
    switch (requestBody.type) {
      case 'Transaction': {
        const { data: transaction } = requestBody
        if (transaction === undefined) {
          throw new WalletError('No transaction present on the request', { code: 400 })
        }
        const identity = await this.veramo.agent.didManagerGet(pathParameters)
        // transaction.from = `0x${identity.keys[0].publicKeyHex}`
        const signature = await this.veramo.agent.keyManagerSignEthTX({
          kid: identity.keys[0].kid,
          transaction
        })
        response = { signature }
        break
      }
      case 'Raw': {
        const { data } = requestBody
        if (data === undefined) {
          throw new WalletError('No data present on the request', { code: 400 })
        }
        const identity = await this.veramo.agent.didManagerGet(pathParameters)
        const signature = await this.veramo.agent.keyManagerSignJWT({
          kid: identity.keys[0].kid,
          data: u8a.fromString(data.payload, 'base64url')
        })
        response = { signature }
        break
      }
      default:
        throw new WalletError('Unknown sign data type')
    }

    return response
  }

  async identityInfo (pathParameters: WalletPaths.IdentityInfo.PathParameters): Promise<WalletPaths.IdentityInfo.Responses.$200> {
    const ddo = await this.veramo.agent.didManagerGet({
      did: pathParameters.did
    })
    const result = _.pick(ddo, ['did', 'alias', 'provider']) as any
    if (ddo.provider.startsWith('did:ethr')) {
      result.addresses = ddo.keys.map((key) => ethers.utils.computeAddress(`0x${key.publicKeyHex}`))
    }

    return result
  }

  async identityDeployTransaction (pathParameters: WalletPaths.IdentityDeployTransaction.PathParameters, requestBody: WalletComponents.Schemas.Transaction): Promise<WalletComponents.Schemas.Receipt> {
    throw new Error('Method not implemented.')
  }

  async getResources (): Promise<BaseWalletModel['resources']> {
    return await this.store.get('resources', {})
  }

  async resourceList (): Promise<WalletPaths.ResourceList.Responses.$200> {
    const resources = await this.getResources()
    return Object.keys(resources).map(key => ({
      id: resources[key].id
    }))
  }

  async deleteResource (id: string): Promise<void> {
    const confirmation = await this.dialog.confirmation({
      message: 'Once deleted you will not be able to recover it. Proceed?',
      acceptMsg: 'Ok',
      rejectMsg: 'Cancel'
    })
    if (confirmation === true) {
      await this.store.delete(`resources.${id}`)
    }
  }

  async deleteIdentity (did: string): Promise<void> {
    const confirmation = await this.dialog.confirmation({
      message: 'Once deleted you will not be able to recover it. Proceed?',
      acceptMsg: 'Ok',
      rejectMsg: 'Cancel'
    })
    if (confirmation === true) {
      await this.store.delete(`identities.${did}`)
    }
  }

  async resourceCreate (requestBody: WalletPaths.ResourceCreate.RequestBody): Promise<WalletPaths.ResourceCreate.Responses.$201> {
    const resource = requestBody

    // Validate resource
    const validation = await this.resourceValidator.validate(resource, this.veramo)
    if (!validation.validated) {
      throw new Error(`Resource type ${resource.type} not supported`)
    }

    if (validation.errors.length > 0) {
      throw new WalletError('Wrong resource format', { status: 400 })
    }

    if (resource.type === 'VerifiableCredential') {
      const credentialSubject = getCredentialClaims(resource.resource)
        .map(claim => `  - ${claim}: ${JSON.stringify(resource.resource.credentialSubject[claim])}`)
        .join('\n')
      const confirmation = await this.dialog.confirmation({
        message: `Do you want to add the following verifiable credential: \n${credentialSubject}`
      })
      if (confirmation !== true) {
        throw new WalletError('User cannceled the operation', { status: 403 })
      }
    }

    // Store resource
    const resourceId = {
      id: uuid()
    }
    const returnResource = Object.assign(resource, resourceId)
    await this.store.set(`resources.${resourceId.id}`, returnResource)
    return resourceId
  }

  async selectiveDisclosure (pathParameters: WalletPaths.SelectiveDisclosure.PathParameters): Promise<WalletPaths.SelectiveDisclosure.Responses.$200> {
    const sdrRaw = pathParameters.jwt
    const sdrMessage = await this.veramo.agent.handleMessage({
      raw: sdrRaw,
      save: false
    })

    if (sdrMessage.from === undefined) {
      throw new WalletError('Selective disclosure request origin not defined')
    }

    const vp = await this.selectCredentialsForSdr(sdrMessage)
    if (vp === undefined) {
      throw new WalletError('No verifiable credentials selected')
    }

    return {
      jwt: vp.proof.jwt
    }
  }

  async transactionDeploy (requestBody: WalletComponents.Schemas.SignedTransaction): Promise<WalletPaths.TransactionDeploy.Responses.$200> {
    await this.executeTransaction({
      transaction: requestBody.transaction
    })
    return {}
  }
}
