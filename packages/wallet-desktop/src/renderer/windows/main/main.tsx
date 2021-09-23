import { pluck } from 'rxjs/operators'

import { MainArgs, withType } from '@wallet/lib'
import { useFilterInput, useSharedMemory } from '@wallet/renderer/communication'

import { Password, Wallet } from './routes'
import { Dialog, DialogProps } from './dialogs'

import './main.scss'

const { HashRouter: Router, Route, useHistory } = ReactRouterDOM

function App (props: MainArgs): JSX.Element {
  const history = useHistory()

  React.useEffect(() => {
    if (history.location.pathname === '/') {
      history.push(props.path)
    }
  }, [])

  // Handle navigate request
  const useNavigateInput = useFilterInput((obs$) => obs$.pipe(
    withType('navigate'),
    pluck('path')
  ))
  useNavigateInput((path) => {
    history.push(path)
  })

  return (
    <div className='window'>
      <Route path='/password'>
        <Password />
      </Route>
      <Route path='/wallet'>
        <Wallet />
      </Route>
    </div>
  )
}

export default function Main (props: MainArgs): JSX.Element {
  const [{ dialogs }, setSharedMemory] = useSharedMemory()
  const dialogData = dialogs.data[dialogs.current ?? '']

  let dialogProps: DialogProps | undefined
  if (dialogData !== undefined) {
    dialogProps = {
      ...dialogData,
      onClose (value: any) {
        // const options: DialogOption[] = []
        // if (value !== undefined) {
        //   options.push(value)
        // }

        setSharedMemory({
          dialogs: {
            data: {
              [dialogData.id]: {
                ...dialogData,
                response: value
              }
            }
          }
        })
      }
    }
  }

  return (
    <Router>
      <App {...props} />
      {
        dialogProps !== undefined ? <Dialog {...dialogProps} /> : null
      }
    </Router>
  )
}
