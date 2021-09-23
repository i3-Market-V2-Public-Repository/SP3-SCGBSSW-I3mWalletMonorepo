import { Resource } from '@i3-market/base-wallet'

interface Props {
  resource: Resource
}

export function IdentityResource (props: Props): JSX.Element {
  const { resource } = props
  const claims = Object.keys(resource.resource.credentialSubject)
    .filter(key => key !== 'id')
    .join(', ')

  const copy: React.MouseEventHandler = async (ev) => {
    await navigator.clipboard.writeText(JSON.stringify(resource, undefined, 2))
  }

  return (
    <div className='resource'>
      <div className='resource-content'>
        <div className='identity-param inline'>
          <span>Type: {resource.type}</span>
        </div>
        <div className='identity-param inline'>
          <span>Claims: </span>
          <input type='text' disabled value={claims} />
        </div>
        <button onClick={copy}>
          Extract
        </button>
      </div>
    </div>
  )
}
