import { Subject } from 'rxjs'
import { Request, Response } from 'express'
import { Action, ActionBuilder, GetAction, GetResponse } from '@wallet/lib'

import { Locals, logger } from '../internal'
import { Module } from './module'
import { ActionHandler } from './action-handler'
import { walletModule } from './wallet'
import { connectModule } from './connect'
import { systemModule } from './system'
import { ActionResult } from './action-result'

export class ActionReducer {
  protected readonly action$: Subject<Action>
  protected handlers: Map<string, ActionHandler>

  constructor (protected locals: Locals) {
    this.action$ = new Subject<Action>()
    this.handlers = new Map()

    this.action$.subscribe((action) => {
      logger.info(`Received action '${action.type as string}'`)
    })

    for (const epic of this.getDefaultModules()) {
      this.addModule(epic)
    }
  }

  protected getDefaultModules (): Module[] {
    return [
      walletModule,
      connectModule,
      systemModule
    ]
  }

  addModule (epic: Module): void {
    epic.bindReducer(this.action$, this.handlers, this.locals)
  }

  async fromApi<B extends Action>(
    req: Request<any, any, any, any>,
    res: Response,
    action: B
  ): Promise<void> {
    // const action = builder.create(req.body)
    const result = await this.reduce(action)
    if (result === undefined) {
      throw new Error(`No handler fount for action type '${action.type as string}'`)
    }
    res.status(result.status ?? 200).json(result.response)
  }

  async reduce<B extends ActionBuilder> (action: GetAction<B>): Promise<ActionResult<GetResponse<B>> | undefined> {
    const handler = this.handlers.get(action.type)
    let result: ActionResult | undefined
    if (handler !== undefined) {
      result = await handler.handle(action)
    }

    this.action$.next(action)

    if (result !== undefined) {
      return result
    }
  }
}
