import { Action as BaseAction } from '../action'
import { ActionBuilder } from '../action-builder'

const type = 'wallet::resource.export'
type Payload = string
type Response = undefined
type Action = BaseAction<typeof type, Payload>

const create = (payload: Payload): Action => {
  return { type, payload }
}

export const exportResourceAction: ActionBuilder<Action, Response, typeof create> = {
  type: type,
  create
}
