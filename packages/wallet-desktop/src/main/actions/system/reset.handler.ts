import {
  resetAction as actionBuilder
} from '@wallet/lib'
import { logger } from '@wallet/main/logger'
import { app } from 'electron'
import rm from 'rimraf'
import { ActionHandlerBuilder } from '../action-handler'
import { promisify } from 'util'

const rmPromise = promisify(rm)

export const reset: ActionHandlerBuilder<typeof actionBuilder> = (
  locals
) => {
  return {
    type: actionBuilder.type,
    async handle (action) {
      // Call the internal function
      if (!locals.auth.authenticated) {
        return { response: undefined, status: 400 }
      }

      const confirm = await locals.dialog.confirmation({
        message: 'The application reset will remove all your personal data. Are you sure?'
      })
      if (confirm === true) {
        logger.info('Reset all wallet information')
        const configPath = app.getPath('userData')
        await rmPromise(configPath)
        app.quit()
      }

      return { response: undefined, status: 400 }
    }
  }
}